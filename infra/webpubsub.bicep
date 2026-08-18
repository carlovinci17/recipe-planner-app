// Module 8 / ADR-0009 — Azure Web PubSub for realtime (replaces Supabase Realtime).
// Free tier: 1 unit = 20 concurrent connections + 20,000 messages/day — ample for a household.
//
// KEYLESS by construction: local (access-key) auth is DISABLED, so the only way in is
// Microsoft Entra RBAC. The negotiate server mints client access tokens as a principal
// holding "Web PubSub Service Owner" — the app Managed Identity in prod, `az login` in dev.
// No connection string or access key to store, leak, or rotate.

@description('Web PubSub resource name.')
param name string = 'wps-recipe-planner'

@description('Object id of the principal to grant Web PubSub Service Owner: your az-login user (dev) or the app Managed Identity (prod).')
param principalId string

@description('Principal type — User for a person (dev), ServicePrincipal for a Managed Identity (prod).')
@allowed(['User', 'ServicePrincipal'])
param principalType string = 'User'

param location string = resourceGroup().location

// Web PubSub Service Owner — full data plane incl. the auth API that mints client access tokens.
var serviceOwnerRoleId = '12cf5a90-567b-43ae-8102-96cf46c7d9b4'

resource wps 'Microsoft.SignalRService/webPubSub@2023-02-01' = {
  name: name
  location: location
  sku: { name: 'Free_F1', tier: 'Free', capacity: 1 }
  properties: {
    disableLocalAuth: true // keyless only — Entra RBAC, no access keys
  }
  tags: { app: 'recipe-planner', module: '8-realtime' }
}

resource ownerRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(wps.id, principalId, serviceOwnerRoleId)
  scope: wps
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', serviceOwnerRoleId)
    principalId: principalId
    principalType: principalType
  }
}

output endpoint string = 'https://${wps.properties.hostName}'
output resourceName string = wps.name
