// Module 5 / ADR-0006 — Azure Blob Storage for recipe images.
// Deployable per environment: pass your az-login object id for a DEV account now;
// the PROD account passes the Container App's Managed Identity at cutover.
//
// KEYLESS by construction: shared-key (account-key) access is DISABLED, so the
// ONLY way in is Microsoft Entra RBAC (Managed Identity in prod, `az login` in
// dev). No keys to store, leak, or rotate — matches ADR-0006 Decision 3.

@description('Storage account name — globally unique, 3-24 lowercase alphanumeric. Default is auto-unique per resource group.')
@minLength(3)
@maxLength(24)
param storageAccountName string = 'strpdev${uniqueString(resourceGroup().id)}'

@description('Object id of the principal to grant Storage Blob Data Contributor: your az-login user (dev) or the app Managed Identity (prod).')
param principalId string

@description('Principal type — User for a person (dev), ServicePrincipal for a Managed Identity (prod).')
@allowed(['User', 'ServicePrincipal'])
param principalType string = 'User'

param location string = resourceGroup().location

// Two private containers, mirroring the Supabase buckets (ADR-0006 Decision 4).
var containers = ['recipe-uploads', 'recipe-images']
// Storage Blob Data Contributor — read/write/delete blobs (+ user-delegation key).
var blobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false // private — no anonymous blob access
    allowSharedKeyAccess: false // keyless only — Entra RBAC, no account keys
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
  tags: { app: 'recipe-planner', module: '5-storage' }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource blobContainers 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = [
  for c in containers: {
    parent: blobService
    name: c
    properties: { publicAccess: 'None' }
  }
]

resource blobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, principalId, blobDataContributorRoleId)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobDataContributorRoleId)
    principalId: principalId
    principalType: principalType
  }
}

output accountName string = storage.name
output blobEndpoint string = storage.properties.primaryEndpoints.blob
