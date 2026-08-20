# Entra External ID sign-in — BiteBuddy branding spec

How to make the Microsoft-hosted sign-in page look like BiteBuddy. All steps are in the
**Microsoft Entra admin center** (role: **Organizational Branding Administrator**), on the
**external tenant**. This is the browser-delegated approach (see ADR-0012).

## Palette (mirrors `app/globals.css`)
| Token | HSL (app) | Hex | Use in Company Branding |
|---|---|---|---|
| Primary (terracotta) | `18 78% 47%` | **#D5531B** | primary button, links, input focus |
| Primary hover | `18 78% 40%` | **#B64616** | button hover |
| Foreground (warm brown) | `25 25% 15%` | **#30251D** | title / body text |
| Muted foreground | `25 10% 40%` | **#6E645C** | subtitle / footer |
| Background (warm off-white) | `40 14% 98%` | **#FCFAF7** | **Page background color** |
| Border | `30 12% 88%` | **#E6E0D9** | input / card borders |

Radius 12px (0.75rem). Fonts: **Inter** (body), **Source Serif 4** (headings).

## Assets to prepare
| Asset | Spec | Notes |
|---|---|---|
| **Favicon** | 32×32 PNG, ≤5 KB | reuse `public/app-icon.png`, resized |
| **Banner logo** | ~245×36 PNG, ≤10 KB | "BiteBuddy" wordmark on transparent bg |
| **Background image** *(optional)* | 1920×1080 PNG/JPG, ≤300 KB | a warm kitchen photo; or skip and use the bg colour |
| **Custom CSS** | `entra-signin.css` (this folder) | colours/fonts to match the app |

## Steps
1. **Rename the tenant** (removes "RECIPE PLANNER CUSTOMERS"): search **Tenant properties** → **Name**
   → `BiteBuddy` → Save.
2. **Entra ID → Custom Branding → Default sign-in → Edit**:
   - **Basics:** upload favicon; set **Page background color** `#FCFAF7`; optional background image.
   - **Layout:** pick **partial-screen** (keeps the sign-in box readable); upload **Custom CSS**
     (`entra-signin.css`); Show header/footer as desired.
   - **Header:** upload the banner logo.
   - **Footer:** set Privacy & Terms links to BiteBuddy URLs (optional).
   - **Review + save.**
3. **Confirm Google is on the user flow** (External Identities → User flows → *your flow* → Identity
   providers → Google). Add Facebook/Apple here later — they'll appear automatically on the branded page.
4. *(Optional)* **Custom domain** `login.bitebuddy.com` so the URL isn't `*.ciamlogin.com`.

## Verify
Private window → app **Log in** → the hosted page shows the BiteBuddy logo, off-white background,
terracotta **Sign in** button, and **no** "Recipe Planner Customers". Note: External ID tenants are
**exempt** from the custom-CSS positioning-property retirement, and this CSS avoids those properties
anyway, so it's future-proof.
