# Test payload
$payload = @{
  action = 'created'
  issue = @{
    number = 1
    pull_request = @{
      url = 'https://api.github.com/repos/owner/repo/pulls/1'
      head = @{
        sha = '1234567890abcdef'
      }
    }
  }
  comment = @{
    body = '/articlecheck'
  }
  repository = @{
    full_name = 'owner/repo'
  }
}

# Convert to JSON
$jsonPayload = $payload | ConvertTo-Json -Compress

# Create signature
$secret = 'test-secret'
$hmac = New-Object System.Security.Cryptography.HMACSHA256
$hmac.Key = [System.Text.Encoding]::UTF8.GetBytes($secret)
$signature = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($jsonPayload))
$signatureHex = [System.BitConverter]::ToString($signature).Replace('-', '').ToLower()

# Send request
$headers = @{
  'content-type' = 'application/json'
  'x-github-event' = 'issue_comment'
  'x-hub-signature-256' = "sha256=$signatureHex"
  'x-github-delivery' = 'test-delivery'
}

# Make the request
$response = Invoke-WebRequest -Uri 'http://127.0.0.1:8787' -Method Post -Headers $headers -Body $jsonPayload

# Output results
Write-Host "Status Code: $($response.StatusCode)"
Write-Host "Response Body: $($response.Content)" 