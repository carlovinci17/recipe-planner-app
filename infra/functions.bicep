targetScope = 'resourceGroup'

// ─────────────────────────────────────────────────────────────────────────────
// Module 6 — Durable Functions app (Flex Consumption, keyless).
// Hosts the background-jobs app (functions/). Scale-to-zero. State (Durable Task
// blobs/queues/tables) + the deployment package live in one storage account that
// is KEYLESS (shared-key access OFF) — the app reaches it only via its
// system-assigned Managed Identity, exactly like the Blob storage in ADR-0006.
// Verified against Microsoft Learn "functions-infrastructure-as-code" (flex pivot).
// ─────────────────────────────────────────────────────────────────────────────

@description('Location for all resources')
param location string = resourceGroup().location

@description('Globally-unique host name for the Functions app.')
param functionAppName string = 'func-recipe-jobs'

@description('Optional App Insights connection string. Empty = skip wiring observability.')
param appInsightsConnectionString string = ''

var storageAccountName = 'stjobs${uniqueString(resourceGroup().id)}'
var deploymentContainerName = 'app-package'

// ── Storage account — Durable state + deployment package. Keyless. ──
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false // keyless — identity only
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource deployContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: deploymentContainerName
  properties: { publicAccess: 'None' }
}

// ── Flex Consumption hosting plan (FC1) — Linux, scale-to-zero. ──
resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'plan-recipe-jobs'
  location: location
  kind: 'functionapp'
  sku: { name: 'FC1', tier: 'FlexConsumption' }
  properties: { reserved: true }
}

// ── The Durable Functions app. ──
resource functionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' } // keyless identity for storage
  properties: {
    serverFarmId: plan.id
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}${deploymentContainerName}'
          authentication: { type: 'SystemAssignedIdentity' }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 40
        instanceMemoryMB: 2048
      }
      runtime: { name: 'node', version: '22' }
    }
    siteConfig: {
      appSettings: concat(
        [
          // Identity-based host storage — no keys. Durable Task state lives here.
          { name: 'AzureWebJobsStorage__accountName', value: storage.name }
        ],
        empty(appInsightsConnectionString) ? [] : [
          { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsightsConnectionString }
        ]
      )
    }
  }
}

// ── Role assignments: the app's identity → its storage account. ──
// Durable Functions (Azure Storage backend) uses blobs, queues AND tables, and
// the deployment package is a blob — so grant all three.
var blobOwnerRoleId = 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b' // Storage Blob Data Owner
var queueContribRoleId = '974c5e8b-45b9-4653-ba55-5f855dd0fb88' // Storage Queue Data Contributor
var tableContribRoleId = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3' // Storage Table Data Contributor

resource blobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, functionApp.id, blobOwnerRoleId)
  scope: storage
  properties: {
    principalId: functionApp.identity.principalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobOwnerRoleId)
    principalType: 'ServicePrincipal'
  }
}

resource queueRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, functionApp.id, queueContribRoleId)
  scope: storage
  properties: {
    principalId: functionApp.identity.principalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', queueContribRoleId)
    principalType: 'ServicePrincipal'
  }
}

resource tableRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, functionApp.id, tableContribRoleId)
  scope: storage
  properties: {
    principalId: functionApp.identity.principalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', tableContribRoleId)
    principalType: 'ServicePrincipal'
  }
}

output functionAppName string = functionApp.name
output functionAppHostName string = functionApp.properties.defaultHostName
output storageAccountName string = storage.name
