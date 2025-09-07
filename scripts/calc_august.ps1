$ErrorActionPreference = 'Stop'

$path = Join-Path $PSScriptRoot '..' | Join-Path -ChildPath 'answers/sourceOfTruth.txt'
$lines = Get-Content -LiteralPath $path

# Locate the start of the August 2025 sales table
$headerMatch = $lines | Select-String -Pattern 'sales data from AUGUST 2025' -CaseSensitive:$false | Select-Object -First 1
if(-not $headerMatch){ throw 'August 2025 sales header not found' }

$startIndex = $headerMatch.LineNumber # 1-based

# Table starts two lines after the header
$dataStart = $startIndex + 2

$rows = @()
for($i=$dataStart-1; $i -lt $lines.Count; $i++){
  $l = $lines[$i]
  if([string]::IsNullOrWhiteSpace($l)){ if($rows.Count -gt 0){ break } else { continue } }
  # Expect: dd/MM/yyyy <tab> venta ...
  $parts = $l -split "`t"
  if($parts.Count -lt 2){ if($rows.Count -gt 0){ break } else { continue } }
  if($parts[0] -notmatch '^(\d{2})/(\d{2})/(\d{4})$'){ if($rows.Count -gt 0){ break } else { continue } }

  $venta = 0.0
  # Use invariant culture to parse dot decimals
  [void][double]::TryParse($parts[1], [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$venta)
  $day   = [int]$parts[0].Substring(0,2)
  $month = [int]$parts[0].Substring(3,2)
  $year  = [int]$parts[0].Substring(6,4)
  $dt    = [datetime]::new($year,$month,$day)
  $isWeekend = $dt.DayOfWeek -in @([DayOfWeek]::Saturday,[DayOfWeek]::Sunday)

  $rows += [pscustomobject]@{ Date=$dt; Venta=$venta; Weekend=$isWeekend }
}

if($rows.Count -eq 0){ throw 'No rows parsed for August 2025 sales' }

$totalRevenue = ($rows | Measure-Object -Property Venta -Sum).Sum
$openDays     = ($rows | Where-Object { $_.Venta -gt 0 }).Count
$openWeekdays = ($rows | Where-Object { $_.Venta -gt 0 -and -not $_.Weekend }).Count
$openWeekends = ($rows | Where-Object { $_.Venta -gt 0 -and $_.Weekend }).Count

Write-Output ('TotalRevenue,{0}' -f ([string]::Format([System.Globalization.CultureInfo]::InvariantCulture,'{0:0.00}',$totalRevenue)))
Write-Output ('OpenDays,{0}' -f $openDays)
Write-Output ('OpenWeekdays,{0}' -f $openWeekdays)
Write-Output ('OpenWeekends,{0}' -f $openWeekends)

# Sum specific invoice amounts for Granados and Rey Camaron
# Find sections and read following currency lines until blank
function Sum-InvoiceSection($marker){
  $startIdx = -1
  for($i=0; $i -lt $lines.Count; $i++){
    if($lines[$i] -match $marker){ $startIdx = $i + 1; break }
  }
  if($startIdx -lt 0){ return 0.0 }
  $sum = 0.0
  # Skip initial blank lines
  while($startIdx -lt $lines.Count -and [string]::IsNullOrWhiteSpace($lines[$startIdx])){ $startIdx++ }
  for($i=$startIdx; $i -lt $lines.Count; $i++){
    $s = $lines[$i]
    if([string]::IsNullOrWhiteSpace($s)){ break }
    $num = ($s -replace '[^0-9\.]','')
    if($num){
      $val = 0.0
      [void][double]::TryParse($num, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$val)
      $sum += $val
    }
  }
  return $sum
}

$granados = Sum-InvoiceSection 'granados facturas del mes de agosto'
$rey      = Sum-InvoiceSection 'rey camaron facturas del mes de agosto'

Write-Output ('GranadosCOGS,{0}' -f ([string]::Format([System.Globalization.CultureInfo]::InvariantCulture,'{0:0.00}',$granados)))
Write-Output ('ReyCamaronCOGS,{0}' -f ([string]::Format([System.Globalization.CultureInfo]::InvariantCulture,'{0:0.00}',$rey)))

# Compute tortilla costs based on rules in notes
$handmadeKg = ($openWeekdays * 4) + ($openWeekends * 7)
$costHandmade = $handmadeKg * 25.0

# Machine-made: 4kg per weekday block + 4kg per weekend block, per week
$weeksInAugust = 31.0 / 7.0
$machineKgPerWeek = 4.0 + 4.0
$machineKg = $weeksInAugust * $machineKgPerWeek
$costMachine = $machineKg * 23.50

$tortillasCOGS = $costHandmade + $costMachine

Write-Output ('TortillasCOGS,{0}' -f ([string]::Format([System.Globalization.CultureInfo]::InvariantCulture,'{0:0.00}',$tortillasCOGS)))

# Agua fresca cost: 0.5 L per weekday open + 1 L per weekend open at 135 MXN/L
$aguaLiters = ($openWeekdays * 0.5) + ($openWeekends * 1.0)
$aguaCOGS = $aguaLiters * 135.0
Write-Output ('AguaFrescaCOGS,{0}' -f ([string]::Format([System.Globalization.CultureInfo]::InvariantCulture,'{0:0.00}',$aguaCOGS)))

# Operating expenses
$weeklyWages = 2400 + 2050 + 700 + 700
$opExWages = $weeklyWages * $weeksInAugust
$opExRent = 13650.0
$opExUtilities = 3000.0 + 400.0 + 400.0
$opExAccountant = 1400.0
$opExAdvertising = 5000.0

# Gas LP: estimate from purchase records using average cost per percentage point and average daily consumption.
# Extract percent deltas and amounts from known entries
$gasEntries = @(
  @{ Amount=599.49; From=23; To=40; Date=[datetime]::new(2025,6,13) },
  @{ Amount=1000.0; From=10; To=39; Date=[datetime]::new(2025,6,30) },
  @{ Amount=1000.0; From=0; To=31; Date=[datetime]::new(2025,7,21) },
  @{ Amount=1200.0; From=9; To=60; Date=[datetime]::new(2025,8,7) },
  @{ Amount=1500.0; From=25; To=73; Date=[datetime]::new(2025,8,21) }
)

$costPerPct = @()
foreach($e in $gasEntries){ $delta = [double]($e.To - $e.From); if($delta -gt 0){ $costPerPct += ($e.Amount / $delta) } }
$avgCostPerPct = ($costPerPct | Measure-Object -Average).Average

# Daily consumption: estimate from Aug 7 (60%) to Aug 20 (25%) ~ 35% over 13 days
$avgDailyPct = 35.0 / 13.0
$opExGas = 31.0 * $avgDailyPct * $avgCostPerPct

Write-Output ('OpExWages,{0}' -f ([string]::Format([System.Globalization.CultureInfo]::InvariantCulture,'{0:0.00}',$opExWages)))
Write-Output ('OpExRent,{0}' -f ([string]::Format([System.Globalization.CultureInfo]::InvariantCulture,'{0:0.00}',$opExRent)))
Write-Output ('OpExUtilities,{0}' -f ([string]::Format([System.Globalization.CultureInfo]::InvariantCulture,'{0:0.00}',$opExUtilities)))
Write-Output ('OpExAccountant,{0}' -f ([string]::Format([System.Globalization.CultureInfo]::InvariantCulture,'{0:0.00}',$opExAccountant)))
Write-Output ('OpExAdvertising,{0}' -f ([string]::Format([System.Globalization.CultureInfo]::InvariantCulture,'{0:0.00}',$opExAdvertising)))
Write-Output ('OpExGas,{0}' -f ([string]::Format([System.Globalization.CultureInfo]::InvariantCulture,'{0:0.00}',$opExGas)))

# Supplies per-month approximate
$opExSupplies = 120 + 240 + 60 + 300 + (5 * 60)  # last term: toilet paper estimate
Write-Output ('OpExSupplies,{0}' -f ([string]::Format([System.Globalization.CultureInfo]::InvariantCulture,'{0:0.00}',$opExSupplies)))

$totalCOGS = $granados + $rey + $tortillasCOGS + $aguaCOGS
$totalOpEx = $opExWages + $opExRent + $opExUtilities + $opExGas + $opExAdvertising + $opExAccountant + $opExSupplies
$net = $totalRevenue - $totalCOGS - $totalOpEx

Write-Output ('TotalCOGS,{0}' -f ([string]::Format([System.Globalization.CultureInfo]::InvariantCulture,'{0:0.00}',$totalCOGS)))
Write-Output ('TotalOpEx,{0}' -f ([string]::Format([System.Globalization.CultureInfo]::InvariantCulture,'{0:0.00}',$totalOpEx)))
Write-Output ('Net,{0}' -f ([string]::Format([System.Globalization.CultureInfo]::InvariantCulture,'{0:0.00}',$net)))
