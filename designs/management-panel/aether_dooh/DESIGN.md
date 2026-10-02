# Design System Specification: The Precision Atmosphere

**Director’s Note to the Team:**
Standard CMS tools in the DOOH space are notoriously cluttered, utilitarian, and visually exhausting. Our goal is to pivot. We aren't just building a dashboard; we are building a high-end editorial experience for data. Think of this design system as a "Digital Curator." It should feel as precise as an aeronautics interface but as refined as a premium architectural magazine. We will achieve this through "Atmospheric Precision"—using tonal depth and sophisticated typography to guide the eye, rather than the rigid, boxy lines of the past.

---

## 1. Creative North Star: The Precision Atmosphere
This design system moves beyond the "template" look by embracing **Intentional Asymmetry** and **Tonal Layering**. 

While traditional dashboards rely on heavy borders to separate content, we will use breathing room (white space) and subtle shifts in surface color to define boundaries. The experience should feel light, airy, and "toned down," allowing the high-density data and status indicators (Green/Yellow/Red) to command attention without competing with the UI frame.

---

## 2. Color & Tonal Architecture
The palette is rooted in the provided professional blue and cool-white tones, designed to reduce eye strain during long-term monitoring.

### The "No-Line" Rule
**Explicit Instruction:** Designers are prohibited from using 1px solid borders for sectioning or layout containment.
Boundaries must be defined solely through background color shifts. For example, a main content area using `surface-container-low` (`#f0f4f8`) should sit directly against the `background` (`#f7f9fd`). The contrast is felt, not seen.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers—like stacked sheets of fine paper. 
*   **Level 0 (Base):** `background` (`#f7f9fd`)
*   **Level 1 (Sections):** `surface-container-low` (`#f0f4f8`)
*   **Level 2 (Cards/Modules):** `surface-container-lowest` (`#ffffff`)
*   **Level 3 (Popovers/Modals):** `surface-bright` (`#f7f9fd`) with high-diffusion ambient shadows.

### The "Glass & Gradient" Rule
To elevate the aesthetic above "standard" tools, use **Glassmorphism** for floating elements (like hover tooltips or global filters). Use semi-transparent surface colors with a `20px` backdrop-blur. 
*   **Signature Textures:** For primary CTAs and high-level analytics headers, use a subtle linear gradient from `primary` (`#006788`) to `primary_container` (`#74d1fe`) at a 135-degree angle. This provides a "soul" to the data that flat color cannot achieve.

---

## 3. Typography: Editorial Authority
We utilize a dual-font strategy to balance character with extreme legibility.

*   **The Voice (Headlines):** **Manrope** is used for all `display` and `headline` roles. Its geometric yet warm curves provide a premium, modern feel.
*   **The Engine (UI/Data):** **Inter** is used for all `title`, `body`, and `label` roles. This ensures maximum readability at high densities (e.g., screen lists, scheduling grids).

**Hierarchy Principle:** Use exaggerated scale contrast. A `display-lg` headline should feel authoritative, while `label-sm` metadata should be tucked away in `on_surface_variant` (`#586066`), only becoming focal when needed.

---

## 4. Elevation & Depth: Tonal Layering
Depth is achieved through "Tonal Layering" rather than structural scaffolding.

*   **Ambient Shadows:** When an element must "float," use an extra-diffused shadow. 
    *   *Specs:* `0px 8px 24px rgba(44, 51, 57, 0.06)`. 
    *   Note the use of the `on_surface` color for the shadow tint to mimic natural light.
*   **The Ghost Border Fallback:** If a border is essential for accessibility (e.g., in a high-density data table), use a **Ghost Border**: `outline_variant` (`#abb3b9`) at **15% opacity**. Never 100%.
*   **Roundedness:** Adhere to a `lg` (`0.5rem`) or `xl` (`0.75rem`) corner radius for all main containers to soften the high-density information.

---

## 5. Components

### High-Density Data Cards
*   **Structure:** No dividers. Use `spacing-5` (`1.1rem`) to separate internal content.
*   **Background:** `surface-container-lowest` (`#ffffff`).
*   **Status Indicators:** Use circular pips for DOOH screen status. 
    *   *Online:* `primary` (`#006788`) — we use blue for "Healthy" to stay on-brand, or a muted green if required.
    *   *Warning:* `tertiary` (`#535d85`) for a sophisticated yellow/gold alternative.
    *   *Critical:* `error` (`#a83836`).

### Signature Buttons
*   **Primary:** Gradient fill (Primary to Primary Container). Text in `on_primary`. Shape: `md` (`0.375rem`).
*   **Secondary:** Ghost style. No fill, `outline` token at 20% opacity.
*   **States:** On hover, primary buttons should "lift" using a `1.02x` scale transform rather than a simple color change.

### DOOH Timeline / Broadcast Strip
*   Use `surface-container-highest` (`#dce3ea`) for the track background.
*   Media blocks should use `primary_fixed` (`#74d1fe`) to represent scheduled content, with `0.2rem` gaps between blocks to ensure the "No-Line" rule is maintained.

### Input Fields
*   **Style:** Understated. Use `surface_container_low` for the fill. 
*   **Focus State:** A soft `2px` outer glow using `primary` at 30% opacity. No harsh black outlines.

---

## 6. Do’s and Don’ts

### Do:
*   **Do** use asymmetrical margins (e.g., a wider left margin for page titles) to create an editorial, "non-app" feel.
*   **Do** leverage the `surface-container` tiers to create hierarchy. If a card is important, place it on a "higher" (lighter) tier.
*   **Do** use `letter-spacing: -0.02em` on Manrope headlines to give them a "tight," professional press look.

### Don’t:
*   **Don’t** use 1px dividers to separate list items. Use `spacing-3` of vertical white space instead.
*   **Don’t** use pure black (#000000) for text. Always use `on_surface` (`#2c3339`) to maintain the "toned down" aesthetic.
*   **Don’t** use standard Material "Floating Action Buttons." They are too disruptive for a high-density dashboard. Use integrated, tertiary-styled actions within the header or section.

---

**Final Direction:** This system should feel like a high-end cockpit. It is powerful enough to manage thousands of screens, but quiet enough to stay out of the user's way. Focus on the "flow" of the blue tones and the clarity of the white space.