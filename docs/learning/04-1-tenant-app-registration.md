# Lesson 4.1 — External ID tenant + app registration

**Date:** 2026-08-11   **Module:** 4 (Authentication)   **WAF pillar(s):** Security, Cost Optimization   **Status:** ✅ Done — sign-in working end-to-end + security-reviewed (Lesson 4.5). Google = Lesson 4.2.
**Decided in:** [ADR-0005](../adr/0005-authentication.md).

## What we did
Stood up the **customer login directory** for the app on Azure and told the directory about our
website. Two portal steps: (1) create a **Microsoft Entra External ID** *external tenant*, (2) an
**app registration** inside it. This is the identity platform that replaces Supabase Auth.

## The two ideas that confused us first (worth keeping)
| Thing | Plain meaning | Analogy |
|---|---|---|
| **Subscription** | The billing account (where spend happens) | Your bank account |
| **Tenant (directory)** | A container of user accounts + sign-in config | A guest book |
| **Home tenant** | Holds **you**, the admin | Staff badge system |
| **External tenant** | Holds your **app's customers** | Customer guest book |

Both tenants hang off the **one** subscription — it's **not** a second bill. And it **is** an Azure
service (Microsoft Entra External ID); nothing lives outside Azure. Identity/credentials live in the
tenant; **profile + app data stays in our own database** (`profiles` + all tables).

## Cost — $0 at our scale
Billed per **Monthly Active Users (MAU)**; **first 50,000 MAU are free** on the core offer
(email/password + Google). We have ~2. **Go-Local data residency** (a paid add-on that meters from
user #1) was left **off** — that's the one switch that would have broken $0.

## Steps (Azure portal → Create a resource → Identity → Microsoft Entra External ID)
- **Tenant:** type **External**; name `Recipe Planner Customers`; domain `recipeplanner.onmicrosoft.com`;
  location **Australia** (permanent); Go-Local **No**; linked to the subscription + `rg-recipe-planner`.
- **App registration** (switch *into* the new tenant first): Entra ID → App registrations → New:
  - **Supported account types:** *Accounts in this organizational directory only* (**single tenant**) —
    all our users live in this one directory.
  - **Redirect URI:** platform **Web**, `http://localhost:3000/api/auth/callback/microsoft-entra-id`
    (the address Auth.js listens on locally; the Azure URL gets added at deploy).
  - **API permissions → Microsoft Graph (delegated):** `openid`, `profile`, `email`, `offline_access`
    → **Grant admin consent**.
  - **Certificates & secrets → New client secret** → copy the **Value** once (it's hidden after).

## Values recorded (three)
`Application (client) ID`, `Directory (tenant) ID`, `Client secret` → stored in **`.env.local`**
(git-ignored), never the repo. The client secret is a password: for production it moves to **Key
Vault** (Module 2), and we **rotate** it before go-live (it passed through chat during setup).

## Gotchas
- Do **not** pick the retired **Azure Active Directory Business-to-Consumer (Azure AD B2C)** — closed
  to new customers since 2025-05-01. Use **Microsoft Entra External ID**.
- **Location can't be changed later** — chosen Australia deliberately.
- Client ID vs tenant ID are easy to swap — a swap silently breaks login. Double-check which is which.

## What's next
- **4.2:** create a **user flow** (email/password first, then **Google** federation) and add the app to it.
- Then wire **Auth.js (NextAuth v5)** in code + the `getCurrentUser()` seam (ADR-0005 Decisions 3–4).

## Evidence / links
- MS Learn: _Quickstart: Use your Azure subscription to create an external tenant_; _Create an external
  tenant_; _Register an application_; _External ID pricing & billing_; _Go-Local add-on (data residency)_.
