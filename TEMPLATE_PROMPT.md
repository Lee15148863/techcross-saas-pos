# Repair Shop Website - Full Stack Template Prompt

Use this prompt to generate a complete repair shop website with different UI/branding but identical functionality.

---

## PROMPT

Build me a complete repair shop website for **[SHOP_NAME]** located at **[ADDRESS]**. The shop repairs phones, tablets, laptops, and gaming consoles.

### Tech Stack
- **Backend**: Node.js + Express 5 + Mongoose (MongoDB Atlas)
- **Frontend**: Vanilla HTML/CSS/JS (no framework), mobile-first responsive
- **Database**: MongoDB Atlas (connection string via `DBCon` env var)
- **Deployment**: Docker + Google Cloud Run (Dockerfile + cloudbuild.yaml)
- **Auth**: Simple token-based admin auth via `ADMIN_TOKEN` env var in request header `x-admin-token`

### Environment Variables
```
DBCon=<mongodb_connection_string>
ADMIN_TOKEN=<admin_secret_token>
PORT=8080
```

### Database Models (Mongoose)

**Brand** — stores all repair pricing data
```
brandId: String (unique, e.g. "apple")
name: String (e.g. "Apple")
types: Mixed — nested structure:
  { typeId: { name, models: { modelId: { name, issues: { issueId: { name, price } } } } } }
  - price: number = actual price, 0 = "Contact Us", -1 = hidden/N/A
updatedAt: Date
```

**Review** — customer reviews with admin approval
```
name: String
rating: Number (1-5)
message: String
approved: Boolean (default false)
createdAt: Date
```

### API Routes

**GET /api/brands** — returns all brands with nested types/models/issues (public)
**GET /api/brands/:brandId** — returns single brand (public)
**PUT /api/brands/:brandId** — create/update brand (admin auth)
**DELETE /api/brands/:brandId** — delete brand (admin auth)

**GET /api/reviews** — returns approved reviews only (public)
**GET /api/reviews/all** — returns all reviews (admin auth)
**POST /api/reviews** — submit a review (public, defaults to unapproved)
**PUT /api/reviews/:id/approve** — approve review (admin auth)
**PUT /api/reviews/:id/reject** — unapprove review (admin auth)
**DELETE /api/reviews/:id** — delete review (admin auth)

### Frontend Pages

**index.html** — Homepage with:
- Sticky nav bar with logo, links (Home, Services, Shop, Contact), WhatsApp button
- Full-width search bar with fuzzy search modal (Ctrl+K shortcut)
  - Smart split: "iphone11" auto-splits to "iphone 11"
  - Exact number matching priority (searching "11" ranks iPhone 11 above iPhone 12)
  - Shorter name boost, brand/type boost
  - Search history with localStorage
- Hero carousel (5 slides with background images, headlines, CTA buttons)
- Stats section (years in business, success rate, quick turnaround)
- Walk-in service banner
- Services grid (4 cards: Phone/Tablet, Data Transfer, Accessories, Laptop/Console)
- Customer Reviews section (loads from /api/reviews, star ratings, submit form with star picker)
- Social Media section (TikTok coming soon + Facebook Page Plugin iframe, side by side grid)
- Shop grid (14 categories: Smartphones, Smartwatches, Audio, Cases, Screen Protectors, Chargers, Cables, Power Banks, Storage, Computer Accessories, Gaming, Camera, Car, Gadgets)
- Contact section (Address, Phone, WhatsApp button prominent, email small, Hours, contact form via Web3Forms)
- Google Maps embed
- Footer with Facebook + TikTok social links
- Floating WhatsApp button (bottom right)
- Language toggle button (English/Irish)
- PWA: manifest.json + service worker (cache-first for static, network-first for API)
- Google Analytics gtag.js

**pricing.html** — Dynamic pricing page:
- Loads all brands from /api/brands
- 3-level drill-down: Brand → Type → Model (grid cards)
- Inline expand panel showing issues table with prices
- "Coming Soon" state for brands with no models (shows contact link)
- Notice box with "confirm your model" + link to find-model page
- Terms & Conditions banner link
- Book repair bar with WhatsApp link

**find-model.html** — How to find your model number:
- Side-by-side layout (Apple left, Android right)
- 4 methods each (Settings, Physical, Box, Broken device)
- Tips and contact info at bottom

**computer-pricing.html** — Laptop & gaming console pricing
**data-transfer.html** — Data transfer service details
**terms.html** — Repair warranty & terms
**shop-coming-soon.html** — Shop placeholder

### Admin Pages (token-protected)

**admin-brands.html** — Brand/pricing management (CRUD for brands, types, models, issues)
**admin-reviews.html** — Review management:
- Tabs: All / Pending / Approved
- Approve, Hide (reject), Delete buttons per review
- Token stored in localStorage after first prompt

### Search System
- **search-data-api.js** — Builds search index from /api/brands at page load
- **search-engine-enhanced.js** — Fuzzy matching with:
  - Smart split (letters/numbers: "iphone11" → "iphone 11")
  - Word-level matching (exact + partial)
  - Number precision scoring
  - Brand/type boost
  - Name length boost (shorter = more specific)
  - Debounced input, result caching, keyboard navigation

### SEO
- robots.txt (allow all, disallow /admin and /api, sitemap link)
- sitemap.xml (all public pages with priority and changefreq)
- Canonical tags on every page
- Schema.org LocalBusiness structured data (JSON-LD)
- Open Graph + Twitter Card meta tags
- Descriptive titles and meta descriptions with local keywords

### PWA
- manifest.json (name, short_name, icons, theme_color, display: standalone)
- sw.js service worker (precache key pages, cache-first for static, network-first for API)

### Image Optimization
- Compressed logo (small version for nav, full for OG tags)
- External images use WebP format parameter (&fm=webp&q=80)
- Preload hero image
- Lazy loading on iframes (maps, social embeds)

### Deployment
- Dockerfile (Node.js)
- cloudbuild.yaml (Google Cloud Build → Cloud Run)
- nginx.conf (for static serving option)

### Customization Points
Replace these for each new shop:
- Shop name, address, phone numbers, email
- WhatsApp number
- Google Maps embed URL
- Facebook page URL
- Google Analytics Measurement ID
- Web3Forms access key (for contact form)
- Logo images
- Color scheme (current: primary #D4E157 lime green, accent #0071e3 blue)
- MongoDB connection string and admin token
- Business hours
- Service descriptions and pricing data

---

Generate all files with a **different UI design** (different color scheme, different layout style, different fonts) but keep all the functionality identical. Make it look like a completely different website while having the same features under the hood.
