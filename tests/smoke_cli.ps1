param([string]$Python = 'python')

# Real command-line integration checks on synthetic fixtures only.
# Run from any directory: pwsh -File tests/smoke_cli.ps1 -Python <python.exe>
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$checker = Join-Path $repo 'knowledge-base-doc-authoring\scripts\check_doc.py'
$scratchParent = Join-Path $PSScriptRoot '.tmp-check-doc'
$runName = [guid]::NewGuid().ToString('N')
$scratch = Join-Path $scratchParent $runName
if (Test-Path -LiteralPath $scratch) { throw 'Refusing to reuse an existing scratch directory.' }
New-Item -ItemType Directory -Path $scratch -Force | Out-Null
$script:Passed = 0

function Invoke-Case {
    param([string]$Label, [int]$ExpectedExit, [string[]]$CheckerArguments)
    $raw = & $Python -B $checker @CheckerArguments --format json
    $actualExit = $LASTEXITCODE
    if ($actualExit -ne $ExpectedExit) { throw "$Label returned $actualExit instead of $ExpectedExit" }
    $report = ($raw -join "`n") | ConvertFrom-Json
    if ($report.schema_version -ne 1 -or $report.model -notlike '*approximation*') {
        throw "$Label returned an unexpected JSON schema/model"
    }
    if ($report.PSObject.Properties.Name -contains 'body') { throw 'Report unexpectedly contains body text.' }
    $script:Passed += 1
    Write-Host "PASS $Label (exit $actualExit)"
    return $report
}

try {
    $compliant = Join-Path $repo 'examples\compliant.md'
    $fragmented = Join-Path $repo 'examples\fragmented.md'
    $protected = Join-Path $PSScriptRoot 'fixtures\protected.md'
    $empty = Join-Path $scratch 'empty.md'
    $unclosed = Join-Path $scratch 'unclosed.md'
    $invalid = Join-Path $scratch 'invalid-utf8.bin'
    $bom = Join-Path $scratch 'bom-crlf.md'
    [System.IO.File]::WriteAllText($empty, '')
    [System.IO.File]::WriteAllText($unclosed, "# Unclosed`n~~~text`nkeep this code")
    [System.IO.File]::WriteAllBytes($invalid, [byte[]](0xFF, 0xFE, 0x80))
    $bomText = "# BOM and CRLF check`r`n" + ('preserve body text. ' * 10) + "`r`n"
    [System.IO.File]::WriteAllBytes($bom, ([byte[]](0xEF, 0xBB, 0xBF) + [System.Text.Encoding]::UTF8.GetBytes($bomText)))
    $before = @{}
    foreach ($path in @($compliant, $fragmented, $protected, $empty, $unclosed, $invalid, $bom)) {
        $before[$path] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    }

    $r = Invoke-Case 'compliant default' 0 @($compliant)
    if ($r.summary.error_count -ne 0 -or $r.summary.warning_count -ne 0) { throw 'Compliant fixture has unexpected findings.' }
    $r = Invoke-Case 'multiple chunks advisory' 0 @($fragmented)
    if ($r.findings.code -notcontains 'MULTIPLE_CHUNKS') { throw 'Missing multiple-chunk advisory.' }
    $r = Invoke-Case 'strict warnings' 1 @($fragmented, '--strict')
    $r = Invoke-Case 'headings model' 0 @($fragmented, '--split-mode', 'headings')
    if ($r.summary.chunk_count -ne 1) { throw 'Headings model unexpectedly split paragraphs.' }
    $r = Invoke-Case 'overlong chunk' 1 @($compliant, '--max-chars', '100')
    if ($r.findings.code -notcontains 'OVERLONG_CHUNK') { throw 'Missing overlong error.' }
    $r = Invoke-Case 'invalid maximum JSON' 2 @($compliant, '--max-chars', 'invalid')
    $r = Invoke-Case 'minimum above maximum JSON' 2 @($compliant, '--max-chars', '50')
    $r = Invoke-Case 'missing file JSON' 2 @((Join-Path $scratch 'does-not-exist.md'))
    $r = Invoke-Case 'legacy positional maximum' 0 @($compliant, '2048')
    $r = Invoke-Case 'protected code strict' 0 @($protected, '--strict')
    if ($r.summary.heading_count -ne 1 -or $r.summary.chunk_count -ne 1) { throw 'Code was split or treated as headings.' }
    $r = Invoke-Case 'empty document' 1 @($empty)
    if ($r.findings.code -notcontains 'EMPTY_DOCUMENT') { throw 'Missing empty-document error.' }
    $r = Invoke-Case 'unclosed fence' 1 @($unclosed)
    if ($r.findings.code -notcontains 'UNCLOSED_FENCE') { throw 'Missing unclosed-fence error.' }
    $r = Invoke-Case 'invalid UTF-8 JSON' 2 @($invalid)
    if ($r.findings.code -notcontains 'ENCODING_ERROR') { throw 'Missing encoding error.' }
    $r = Invoke-Case 'BOM and CRLF' 0 @($bom, '--strict')
    if ($r.summary.heading_count -ne 1) { throw 'BOM obscured the heading.' }
    $r = Invoke-Case 'conflicting maxima JSON' 2 @($compliant, '2048', '--max-chars', '2048')

    foreach ($path in $before.Keys) {
        if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $before[$path]) {
            throw "Checker modified fixture: $path"
        }
    }
    Write-Host "All $script:Passed real CLI cases passed; input hashes unchanged."
}
finally {
    # Delete only the unique synthetic-fixture directory created by this run.
    if (Test-Path -LiteralPath $scratch) {
        $resolved = (Resolve-Path -LiteralPath $scratch).Path
        $expectedParent = (Resolve-Path -LiteralPath $scratchParent).Path
        if ((Split-Path -Parent $resolved) -ne $expectedParent -or (Split-Path -Leaf $resolved) -ne $runName) {
            throw "Unexpected scratch cleanup target: $resolved"
        }
        Write-Host "Verified scratch cleanup target: $resolved"
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
