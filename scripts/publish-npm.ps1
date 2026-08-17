# One-shot npm publish for dsh-plugin-scorecard.
# Token: $DSH_HOME/secrets/npm-token.txt or $env:NPM_TOKEN — never pasted in chat.
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $MyInvocation.MyCommand.Path -Parent) -Parent
$secrets = Join-Path $env:DSH_HOME 'secrets\npm-token.txt'
$token = $env:NPM_TOKEN
if (-not $token -and (Test-Path $secrets)) { $token = (Get-Content $secrets -Raw).Trim() }
if (-not $token) { throw 'npm token missing: set NPM_TOKEN or create $DSH_HOME/secrets/npm-token.txt' }
$npmrc = Join-Path $root '.npmrc'
try {
  Set-Content -Path $npmrc -Value ("//registry.npmjs.org/:_authToken=" + $token) -Encoding ascii
  $cache = Join-Path $root '.npm-cache'
  if ($env:DSH_NODE_DIR) {
    $node = Join-Path $env:DSH_NODE_DIR 'node.exe'
    $npmCli = Join-Path $env:DSH_NODE_DIR 'node_modules\npm\bin\npm-cli.js'
    if (Test-Path $npmCli) { & $node $npmCli publish --ignore-scripts --cache $cache 2>&1 }
    else { & $node (Join-Path (Split-Path $env:DSH_NODE_DIR) 'node_modules\npm\bin\npm-cli.js') publish --ignore-scripts --cache $cache 2>&1 }
  } else {
    npm publish --ignore-scripts --cache $cache 2>&1
  }
  if ($LASTEXITCODE -ne 0) { throw "npm publish failed (exit $LASTEXITCODE)" }
  Write-Host 'published - check https://www.npmjs.com/package/dsh-plugin-scorecard'
} finally {
  Remove-Item -Force $npmrc -ErrorAction SilentlyContinue
}
