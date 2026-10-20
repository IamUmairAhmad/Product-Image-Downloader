# Product Image Downloader (Chrome Extension)

Download product images from a product page as a single ZIP, with every image converted to **1080 × 1080 px**.

**Supported:** Amazon (all regional sites), Walmart, eBay, Etsy, AliExpress, Alibaba, Shopify stores and WooCommerce stores. Other sites fall back to a generic scan (JSON-LD, `og:image`, large `<img>` tags).

## Install (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose this folder.
4. Pin the extension, open a product page, and click its icon.

## Usage

- **Select Images** – shows every image found, tick the ones you want, then **Download selected**.
- **Download All** – downloads every image found.

Both produce one ZIP named after the product, e.g. `my-product-1080x1080.zip`, containing `my-product-01.jpg`, `my-product-02.jpg`, …

### Options

| Option | Behaviour |
| --- | --- |
| Fit (default) | Whole image is kept, centred on a white 1080 × 1080 canvas. No distortion, no cropping. |
| Fill | Image is scaled to cover the canvas and centre-cropped to a square. |
| JPG / PNG | Output format (JPG quality 0.95). |

Images that are not already 1080 × 1080 are converted before being added to the ZIP. Smaller images are scaled up.

## How it works

- `extractor.js` – injected into the page; site-specific logic finds the full-size product images (for example Amazon `colorImages`, Walmart `__NEXT_DATA__`, Shopify `/products/<handle>.js`, WooCommerce gallery and variation data) and upgrades thumbnail URLs to originals.
- `offscreen.js` – fetches each image, draws it onto a 1080 × 1080 canvas, and builds the ZIP (`zip.js`). Runs in an offscreen document so downloads keep going if the popup closes.
- `background.js` – starts the job, triggers the download, and shows progress on the toolbar badge.

## Notes

- Requires Chrome 116 or newer.
- Site layouts change often; if a site stops returning images, the extractor for that site in `extractor.js` is the place to adjust.
- Only download images you have the right to use.
