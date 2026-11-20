# 设计来源与复用范围

本版本独立编写实现，未复制下列项目的脚本，未将它们设为安装依赖。设计参考如下；这些项目各自的许可证和版本以其仓库为准。

| 来源 | 吸收的设计 | 本版本的取舍 |
|---|---|---|
| https://github.com/back1ply/skills | article-to-skill 的类型判断、来源追溯、增量补充 | 用标准库重写读取分段；按中文字符衡量，保留正文尾段 |
| https://github.com/yusufkaraaslan/Skill_Seekers | 统一来源入口与按需转换 | 第一版只实现网页和文本，不安装整套模型与 RAG 依赖 |
| https://github.com/virgiliojr94/book-to-skill | 长材料的按需读取、主题组织 | 不按书章节机械组织所有生成结果，不建宿主链接 |
| https://github.com/MengTo/Skills | 独立能力、迁移使用和真实验收 | 按产物选择验证，不默认附网页演示、截图图库与 git 提交 |
| https://github.com/virgiliojr94/x-to-skill | 快照、来源归属、矛盾和覆盖范围 | 不复用授权未确认的代码，不操作登录 Chrome，不把单帖扩成账号采集 |

后续解析器确需引用第三方实现时，再单独核对版本、许可、依赖与授权，并保留相应声明。
