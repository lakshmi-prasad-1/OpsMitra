param(
  [string]$BaseUrl = "http://localhost:4000"
)
$ErrorActionPreference = 'Stop'
$stamp = [guid]::NewGuid().ToString('N')
$password = "OpsMitra!$($stamp.Substring(0, 10))"
$emailA = "opsmitra-smoke-a-$stamp@example.com"
$emailB = "opsmitra-smoke-b-$stamp@example.com"

function Invoke-OpsApi {
  param([string]$Method, [string]$Path, [string]$Token = '', $Body = $null, [switch]$BearerMode)
  $headers = @{}
  if ($Token) { $headers.Authorization = "Bearer $Token" }
  if ($BearerMode) { $headers['X-OpsMitra-Auth-Mode'] = 'bearer' }
  $requestArgs = @{ Method = $Method; Uri = "$BaseUrl$Path"; Headers = $headers }
  if ($null -ne $Body) { $requestArgs.ContentType = 'application/json'; $requestArgs.Body = ($Body | ConvertTo-Json -Depth 10) }
  return Invoke-RestMethod @requestArgs
}

function Assert-OpsApiStatus {
  param([string]$Method, [string]$Path, [string]$Token = '', $Body = $null, [int]$ExpectedStatus)
  try {
    $null = Invoke-OpsApi -Method $Method -Path $Path -Token $Token -Body $Body
  } catch {
    $response = $_.Exception.Response
    if ($null -ne $response) {
      $actual = [int]$response.StatusCode
      if ($actual -eq $ExpectedStatus) { return }
      throw "Expected HTTP $ExpectedStatus for $Method $Path, got HTTP $actual. $($_.Exception.Message)"
    }
    throw
  }
  throw "Expected HTTP $ExpectedStatus for $Method $Path, but the request succeeded."
}

Write-Host "1/9 Checking API and database health..."
$health = Invoke-OpsApi -Method GET -Path '/api/health'
if ($health.status -ne 'ok' -or $health.database -ne 'connected' -or $health.schema -ne 'ready') { throw "API/schema health check failed. Message: $($health.message). Confirm MySQL is connected and the required migrations have been applied." }

Write-Host "2/9 Creating two isolated test accounts..."
$a = Invoke-OpsApi -Method POST -Path '/api/auth/register' -BearerMode -Body @{ name = 'OpsMitra Smoke A'; email = $emailA; password = $password }
$b = Invoke-OpsApi -Method POST -Path '/api/auth/register' -BearerMode -Body @{ name = 'OpsMitra Smoke B'; email = $emailB; password = $password }
$tokenA = $a.data.token
$tokenB = $b.data.token
$loginA = Invoke-OpsApi -Method POST -Path '/api/auth/login' -BearerMode -Body @{ email = $emailA; password = $password }
$tokenA = $loginA.data.token

Write-Host "3/9 Creating products and checking validation..."
$skuA = "SMOKE-A-$($stamp.Substring(0, 10))"
$skuB = "SMOKE-B-$($stamp.Substring(0, 10))"
$productA = Invoke-OpsApi -Method POST -Path '/api/products' -Token $tokenA -Body @{ name = 'Phase 4 Smoke Product A'; sku = $skuA; category = 'QA'; sellingPrice = 100; quantity = 10; lowStockThreshold = 2 }
$productB = Invoke-OpsApi -Method POST -Path '/api/products' -Token $tokenA -Body @{ name = 'Phase 4 Smoke Product B'; sku = $skuB; category = 'QA'; sellingPrice = 35; quantity = 1; lowStockThreshold = 1 }
$idA = $productA.data.id
$idB = $productB.data.id
$editedA = Invoke-OpsApi -Method PATCH -Path "/api/products/$idA" -Token $tokenA -Body @{ name = 'Phase 4 Smoke Product A Edited' }
if ($editedA.data.name -ne 'Phase 4 Smoke Product A Edited') { throw 'Product edit did not persist.' }
Assert-OpsApiStatus -Method PATCH -Path "/api/products/$idA" -Token $tokenA -ExpectedStatus 400 -Body @{ quantity = 999 }
$customerBody = @{ requestKey = [guid]::NewGuid().ToString(); name = 'Smoke Customer'; phone = '9876500001'; email = "smoke-$stamp@example.com" }
$customer = Invoke-OpsApi -Method POST -Path '/api/customers' -Token $tokenA -Body $customerBody
$customerReplay = Invoke-OpsApi -Method POST -Path '/api/customers' -Token $tokenA -Body $customerBody
if ([string]$customerReplay.data.id -ne [string]$customer.data.id -or $customerReplay.replayed -ne $true) { throw 'Retrying the same customer request created a duplicate instead of returning the original record.' }
Assert-OpsApiStatus -Method POST -Path '/api/customers' -Token $tokenA -ExpectedStatus 409 -Body @{ requestKey = $customerBody.requestKey; name = 'Different Customer'; phone = $customerBody.phone; email = $customerBody.email }
$customerId = $customer.data.id
$customerEdit = Invoke-OpsApi -Method PATCH -Path "/api/customers/$customerId" -Token $tokenA -Body @{ name = 'Smoke Customer Updated' }
if ($customerEdit.data.name -ne 'Smoke Customer Updated') { throw 'Customer edit did not persist.' }
Assert-OpsApiStatus -Method POST -Path '/api/products' -Token $tokenA -ExpectedStatus 409 -Body @{ name = 'Duplicate SKU'; sku = $skuA; sellingPrice = 1; quantity = 1; lowStockThreshold = 1 }

Write-Host "4/9 Verifying account isolation..."
$accountBProducts = Invoke-OpsApi -Method GET -Path '/api/products' -Token $tokenB
if (@($accountBProducts.data).Count -ne 0) { throw 'Account isolation failed: account B can see account A inventory.' }
$accountBCustomers = Invoke-OpsApi -Method GET -Path '/api/customers' -Token $tokenB
if (@($accountBCustomers.data).Count -ne 0) { throw 'Account isolation failed: account B can see account A customers.' }
Assert-OpsApiStatus -Method GET -Path "/api/products/$idA" -Token $tokenB -ExpectedStatus 404

Write-Host "5/9 Verifying multi-item sale rollback on insufficient stock..."
Assert-OpsApiStatus -Method POST -Path '/api/sales' -Token $tokenA -ExpectedStatus 409 -Body @{ requestKey = [guid]::NewGuid().ToString(); items = @(@{ productId = $idA; quantity = 1 }, @{ productId = $idB; quantity = 2 }) }
$afterFailedSale = Invoke-OpsApi -Method GET -Path '/api/products' -Token $tokenA
$checkA = $afterFailedSale.data | Where-Object { [string]$_.id -eq [string]$idA } | Select-Object -First 1
$checkB = $afterFailedSale.data | Where-Object { [string]$_.id -eq [string]$idB } | Select-Object -First 1
if ([int]$checkA.quantity -ne 10 -or [int]$checkB.quantity -ne 1) { throw 'Failed multi-item sale changed stock; transaction rollback is broken.' }

Write-Host "6/9 Recording a valid multi-item sale and checking stock..."
$saleBody = @{ requestKey = [guid]::NewGuid().ToString(); customerId = $customerId; items = @(@{ productId = $idA; quantity = 2 }, @{ productId = $idB; quantity = 1 }) }
$sale = Invoke-OpsApi -Method POST -Path '/api/sales' -Token $tokenA -Body $saleBody
$saleReplay = Invoke-OpsApi -Method POST -Path '/api/sales' -Token $tokenA -Body $saleBody
if ([string]$saleReplay.data.id -ne [string]$sale.data.id -or $saleReplay.replayed -ne $true) { throw 'Retrying the same sale request created a duplicate instead of returning the original sale.' }
Assert-OpsApiStatus -Method POST -Path '/api/sales' -Token $tokenA -ExpectedStatus 409 -Body @{ requestKey = $saleBody.requestKey; customerId = $customerId; items = @(@{ productId = $idA; quantity = 1 }, @{ productId = $idB; quantity = 1 }) }
if ([decimal]$sale.data.totalAmount -ne 235) { throw "Sale total is inconsistent; expected 235, got $($sale.data.totalAmount)." }
$products = Invoke-OpsApi -Method GET -Path '/api/products' -Token $tokenA
$checkA = $products.data | Where-Object { [string]$_.id -eq [string]$idA } | Select-Object -First 1
$checkB = $products.data | Where-Object { [string]$_.id -eq [string]$idB } | Select-Object -First 1
if ([int]$checkA.quantity -ne 8 -or [int]$checkB.quantity -ne 0) { throw 'Multi-item sale stock deduction was incorrect.' }
$accountBSales = Invoke-OpsApi -Method GET -Path '/api/sales' -Token $tokenB
$accountBOrders = Invoke-OpsApi -Method GET -Path '/api/orders' -Token $tokenB
if (@($accountBSales.data).Count -ne 0 -or @($accountBOrders.data).Count -ne 0) { throw 'Account isolation failed: account B can see account A transactions.' }

Write-Host "7/9 Verifying atomic relative stock adjustments..."
$adjusted = Invoke-OpsApi -Method PATCH -Path "/api/products/$idA/stock" -Token $tokenA -Body @{ delta = -1 }
if ([int]$adjusted.data.quantity -ne 7) { throw 'Stock decrement endpoint returned an incorrect quantity.' }
$adjusted = Invoke-OpsApi -Method PATCH -Path "/api/products/$idA/stock" -Token $tokenA -Body @{ delta = 1 }
if ([int]$adjusted.data.quantity -ne 8) { throw 'Stock increment endpoint returned an incorrect quantity.' }
Assert-OpsApiStatus -Method PATCH -Path "/api/products/$idA/stock" -Token $tokenA -ExpectedStatus 409 -Body @{ delta = -100 }

Write-Host "8/9 Verifying order completion/cancellation is idempotent..."
$orderBody = @{ requestKey = [guid]::NewGuid().ToString(); customerId = $customerId; items = @(@{ productId = $idA; quantity = 3 }) }
$order = Invoke-OpsApi -Method POST -Path '/api/orders' -Token $tokenA -Body $orderBody
$orderReplay = Invoke-OpsApi -Method POST -Path '/api/orders' -Token $tokenA -Body $orderBody
if ([string]$orderReplay.data.id -ne [string]$order.data.id -or $orderReplay.replayed -ne $true) { throw 'Retrying the same order request created a duplicate instead of returning the original order.' }
Assert-OpsApiStatus -Method POST -Path '/api/orders' -Token $tokenA -ExpectedStatus 409 -Body @{ requestKey = $orderBody.requestKey; customerId = $customerId; items = @(@{ productId = $idA; quantity = 2 }) }
Invoke-OpsApi -Method PATCH -Path "/api/orders/$($order.data.id)/status" -Token $tokenA -Body @{ status = 'completed' } | Out-Null
Invoke-OpsApi -Method PATCH -Path "/api/orders/$($order.data.id)/status" -Token $tokenA -Body @{ status = 'completed' } | Out-Null
$products = Invoke-OpsApi -Method GET -Path '/api/products' -Token $tokenA
$checkA = $products.data | Where-Object { [string]$_.id -eq [string]$idA } | Select-Object -First 1
if ([int]$checkA.quantity -ne 5) { throw 'Completing an order more than once deducted stock more than once.' }
$completedReport = Invoke-OpsApi -Method GET -Path '/api/reports?range=7d' -Token $tokenA
if ([decimal]$completedReport.data.totals.revenue -ne 535 -or [int]$completedReport.data.totals.salesCount -ne 2) { throw 'Completing an order did not create exactly one linked revenue sale.' }
$linkedSale = (Invoke-OpsApi -Method GET -Path '/api/sales' -Token $tokenA).data | Where-Object { [string]$_.sourceOrderId -eq [string]$order.data.id } | Select-Object -First 1
if ($null -eq $linkedSale -or $linkedSale.saleStatus -ne 'completed') { throw 'Completed order is missing its linked completed sales record.' }
Invoke-OpsApi -Method PATCH -Path "/api/orders/$($order.data.id)/status" -Token $tokenA -Body @{ status = 'cancelled' } | Out-Null
Invoke-OpsApi -Method PATCH -Path "/api/orders/$($order.data.id)/status" -Token $tokenA -Body @{ status = 'cancelled' } | Out-Null
$products = Invoke-OpsApi -Method GET -Path '/api/products' -Token $tokenA
$checkA = $products.data | Where-Object { [string]$_.id -eq [string]$idA } | Select-Object -First 1
if ([int]$checkA.quantity -ne 8) { throw 'Cancelling an order restored stock incorrectly or more than once.' }
$cancelledReport = Invoke-OpsApi -Method GET -Path '/api/reports?range=7d' -Token $tokenA
if ([decimal]$cancelledReport.data.totals.revenue -ne 235 -or [int]$cancelledReport.data.totals.salesCount -ne 1) { throw 'Cancelling a completed order did not void its linked sale from revenue reports.' }
$voidedSale = (Invoke-OpsApi -Method GET -Path '/api/sales' -Token $tokenA).data | Where-Object { [string]$_.sourceOrderId -eq [string]$order.data.id } | Select-Object -First 1
if ($null -eq $voidedSale -or $voidedSale.saleStatus -ne 'voided') { throw 'Cancelled completed order did not void its linked sales record.' }
Assert-OpsApiStatus -Method PATCH -Path "/api/orders/$($order.data.id)/status" -Token $tokenA -ExpectedStatus 400 -Body @{ status = 'pending' }
Assert-OpsApiStatus -Method PATCH -Path "/api/orders/$($order.data.id)/status" -Token $tokenA -ExpectedStatus 400 -Body @{ status = 'ready' }

Write-Host "9/9 Verifying database-backed reports, dashboard and insights..."
$report = Invoke-OpsApi -Method GET -Path '/api/reports?range=7d' -Token $tokenA
if ([decimal]$report.data.totals.revenue -ne 235 -or [int]$report.data.totals.salesCount -ne 1) { throw 'Report totals do not match the single non-voided sale.' }
if (@($report.data.trend).Count -ne 7) { throw 'The 7-day report must return exactly seven date buckets.' }
$summary = Invoke-OpsApi -Method GET -Path '/api/dashboard/summary' -Token $tokenA
if ([int]$summary.data.totalProducts -ne 2 -or [int]$summary.data.lowStockItems -ne 1) { throw 'Dashboard summary does not match current active inventory and low-stock thresholds.' }
$insights = Invoke-OpsApi -Method GET -Path '/api/insights' -Token $tokenA
if ($null -eq $insights.data.insights -or @($insights.data.insights).Count -lt 1) { throw 'Insights response is missing expected recommendations.' }

Write-Host '  Checking demo-seed behavior and soft deactivation...'
$seed = Invoke-OpsApi -Method POST -Path '/api/demo/seed' -Token $tokenB
if ([int]$seed.data.products -lt 30 -or [int]$seed.data.sales -lt 100 -or [int]$seed.data.orders -lt 10) { throw 'Sample workspace seed counts are inconsistent.' }
$seedReport = Invoke-OpsApi -Method GET -Path '/api/reports?range=90d' -Token $tokenB
if ([int]$seedReport.data.totals.salesCount -lt 100 -or [decimal]$seedReport.data.totals.revenue -le 0) { throw 'Seeded sample sales did not appear in revenue reports.' }
$health2 = Invoke-OpsApi -Method GET -Path '/api/health'
if ($health2.integrity -ne 'ok') { throw 'Data integrity check failed after loading the sample workspace.' }
Assert-OpsApiStatus -Method POST -Path '/api/demo/seed' -Token $tokenB -ExpectedStatus 409
$deactivated = Invoke-OpsApi -Method DELETE -Path "/api/products/$idB" -Token $tokenA
$activeAfterDeactivate = Invoke-OpsApi -Method GET -Path '/api/products' -Token $tokenA
if (@($activeAfterDeactivate.data).Count -ne 1) { throw 'Product deactivation did not remove it from active inventory.' }
$inactive = Invoke-OpsApi -Method GET -Path "/api/products/$idB" -Token $tokenA
if ($inactive.data.isActive -ne $false) { throw 'A deactivated product should stay viewable (so it can be restored) but be marked inactive.' }

Write-Host ''
Write-Host 'PASS: health, register/login, CRUD edits, account isolation, duplicate SKU and absolute-stock validation, multi-item rollback, stock adjustments, order-linked revenue, cancellation/void consistency, idempotency, reports, dashboard, insights, demo seed, and deactivation.' -ForegroundColor Green
Write-Host 'The script creates two uniquely named temporary accounts plus test data. They remain in the selected database so the run can be inspected; remove them after review if desired.'
