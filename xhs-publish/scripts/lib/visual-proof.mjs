// Visible-image proof for platforms that use blob previews or re-encode crops.
// No canvas pixel reads, CORS bypass, hidden application state, network APIs or credentials.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
const sha=b=>createHash('sha256').update(b).digest('hex');
function pngRgb(buffer){
 if(!Buffer.isBuffer(buffer)||!buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('Expected a Chrome PNG screenshot');
 let width,height,channels,interlace,depth;const chunks=[];
 for(let p=8;p+12<=buffer.length;){const len=buffer.readUInt32BE(p),type=buffer.toString('ascii',p+4,p+8);if(len>16000000||p+12+len>buffer.length)throw new Error('Invalid PNG chunk');const b=buffer.subarray(p+8,p+8+len);if(type==='IHDR'){width=b.readUInt32BE(0);height=b.readUInt32BE(4);depth=b[8];channels=b[9]===2?3:b[9]===6?4:0;interlace=b[12];}if(type==='IDAT')chunks.push(b);p+=len+12;if(type==='IEND')break;}
 if(!width||!height||width*height>2000000||depth!==8||!channels||interlace!==0)throw new Error('Unsupported screenshot PNG dimensions/format');
 const stride=width*channels,expected=(stride+1)*height,raw=inflateSync(Buffer.concat(chunks),{maxOutputLength:expected+1});if(raw.length!==expected)throw new Error('Unexpected PNG row length');
 const pixels=Buffer.alloc(stride*height),paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
 for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];if(filter>4)throw new Error('Unsupported PNG filter');for(let x=0;x<stride;x++){const i=y*stride+x,a=x>=channels?pixels[i-channels]:0,b=y?pixels[i-stride]:0,c=y&&x>=channels?pixels[i-stride-channels]:0;const predictor=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c);pixels[i]=(raw[y*(stride+1)+1+x]+predictor)&255;}}
 const rgb=Buffer.alloc(width*height*3);for(let i=0,j=0;i<pixels.length;i+=channels,j+=3){const alpha=channels===4?pixels[i+3]/255:1;for(let k=0;k<3;k++)rgb[j+k]=Math.round(pixels[i+k]*alpha+255*(1-alpha));}return{width,height,rgb};
}
export function comparePngBuffers(reference,actual){
 const a=pngRgb(reference),b=pngRgb(actual);if(a.width!==b.width||a.height!==b.height)return{verified:false,reason:'dimensions-mismatch',referenceWidth:a.width,referenceHeight:a.height,actualWidth:b.width,actualHeight:b.height};
 let error=0,contrast=0,changed=0;for(let p=0;p<a.rgb.length;p+=3){let maximum=0;for(let k=0;k<3;k++){const d=Math.abs(a.rgb[p+k]-b.rgb[p+k]);error+=d;contrast+=255-a.rgb[p+k];maximum=Math.max(maximum,d);}if(maximum>48)changed++;}
 const meanAbsoluteError=error/a.rgb.length,errorRatio=error/Math.max(contrast,a.rgb.length),changedFraction=changed/(a.width*a.height);
 return{verified:meanAbsoluteError<=5&&errorRatio<=0.30&&changedFraction<=0.08,width:a.width,height:a.height,meanAbsoluteError,errorRatio,changedFraction,thresholds:{meanAbsoluteError:5,errorRatio:0.30,changedFraction:0.08},referencePixelSha256:sha(a.rgb),actualPixelSha256:sha(b.rgb)};
}
const validSource=s=>typeof s==='string'&&(/^(?:data:image\/(?:png|jpeg|webp);base64,|https:\/\/|blob:(?:https?:\/\/|null\/))/i.test(s));
async function captureSource(page,source,{width,height,fit}){
 if(!validSource(source))throw new Error('Visual proof accepts only image data, HTTPS or same-page blob images');
 await page.cdp.send('Page.bringToFront',{});
 const id=randomUUID(),scroll=await page.eval('({x:window.scrollX,y:window.scrollY})');
 try{
  const r=await page.eval(`(async()=>{if(innerWidth<${width+16}||innerHeight<${height+16})throw new Error('Viewport too small for visual proof');window.scrollTo(0,0);const im=document.createElement('img');im.setAttribute('data-editorial-visual-proof',${JSON.stringify(id)});im.alt='';im.style.cssText=${JSON.stringify(`display:block!important;position:fixed!important;left:8px!important;top:8px!important;width:${width}px!important;height:${height}px!important;z-index:2147483647!important;background:#fff!important;object-fit:${fit}!important;object-position:center!important;margin:0!important;border:0!important;padding:0!important;box-sizing:border-box!important;opacity:1!important;visibility:visible!important;max-width:none!important;max-height:none!important;min-width:0!important;min-height:0!important;transform:none!important;filter:none!important;mix-blend-mode:normal!important;`)};im.src=${JSON.stringify(source)};document.body.appendChild(im);await im.decode();if(!im.complete||!im.naturalWidth)throw new Error('Visual proof image not loaded');await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const q=im.getBoundingClientRect();return{x:q.x,y:q.y,width:q.width,height:q.height,naturalWidth:im.naturalWidth,naturalHeight:im.naturalHeight};})()`);
  const shot=await page.cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false,clip:{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}});
  return{png:Buffer.from(shot.data,'base64'),naturalWidth:r.naturalWidth,naturalHeight:r.naturalHeight};
 }finally{await page.eval(`(()=>{document.querySelector('[data-editorial-visual-proof="${id}"]')?.remove();window.scrollTo(${Number(scroll?.x)||0},${Number(scroll?.y)||0});return true;})()`).catch(()=>{});}
}
export async function compareRenderedSources(page,referenceSrc,actualSrc,{width=216,height=288,fit='contain',prefix}={}){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<16||height<16||width>800||height>800||!['contain','cover'].includes(fit))throw new Error('Invalid visual proof geometry');
 const reference=await captureSource(page,referenceSrc,{width,height,fit}),actual=await captureSource(page,actualSrc,{width,height,fit});
 const result={...comparePngBuffers(reference.png,actual.png),fit,referenceNaturalWidth:reference.naturalWidth,referenceNaturalHeight:reference.naturalHeight,actualNaturalWidth:actual.naturalWidth,actualNaturalHeight:actual.naturalHeight};
 if(prefix){if(!path.isAbsolute(prefix))throw new Error('Absolute visual evidence prefix required');fs.mkdirSync(path.dirname(prefix),{recursive:true});const a=prefix+'-reference.png',b=prefix+'-actual.png';if(fs.existsSync(a)||fs.existsSync(b))throw new Error('Visual evidence already exists');fs.writeFileSync(a,reference.png);fs.writeFileSync(b,actual.png);result.referenceScreenshot=a;result.actualScreenshot=b;}
 return result;
}
