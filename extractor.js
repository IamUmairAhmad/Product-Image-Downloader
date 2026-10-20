/*
 * Injected into the product page (MAIN world). Defines window.__pidExtract(),
 * which returns { site, title, images: [{ url, fallbacks: [] }] }.
 * Each image has the best-quality URL first and the originally found URLs as
 * fallbacks, so the downloader can retry if an "upgraded" URL does not exist.
 */
(() => {
  if (window.__pidExtract) return;

  window.__pidExtract = async function () {
    const host = location.hostname.toLowerCase();

    // ---------- helpers ----------
    const abs = (u) => {
      if (!u || typeof u !== 'string') return null;
      u = u.trim();
      if (!u || /^(data|blob|javascript):/i.test(u)) return null;
      try {
        return new URL(u, location.href).href;
      } catch (e) {
        return null;
      }
    };

    function keyOf(u) {
      let m;
      if ((m = u.match(/\/images\/I\/([^./]+)/))) return 'amz:' + m[1];
      if ((m = u.match(/ebayimg\.com\/(?:thumbs\/)?images\/g\/([^/]+)/))) return 'ebay:' + m[1];
      if ((m = u.match(/\/il\/[^/]+\/(\d+)\//))) return 'etsy:' + m[1];
      let s = u.split(/[?#]/)[0].toLowerCase();
      s = s.replace(/(\.(?:jpe?g|png|webp|avif))_[^/]*$/, '$1');
      s = s.replace(/il_[0-9a-z]+x[0-9a-zn]+|il_fullxfull/, 'il');
      s = s.replace(/[-_]\d{2,4}x\d{0,4}(?=\.\w+$)/, '');
      s = s.replace(/_(pico|icon|thumb|small|compact|medium|large|grande|master)(?=\.\w+$)/, '');
      return s;
    }

    const items = [];
    const seen = new Set();
    function add(url, ...fallbacks) {
      const main = abs(url);
      if (!main) return;
      const k = keyOf(main);
      if (seen.has(k)) return;
      seen.add(k);
      const fb = [];
      fallbacks.forEach((f) => {
        const a = abs(f);
        if (a && a !== main && !fb.includes(a)) fb.push(a);
      });
      items.push({ url: main, fallbacks: fb });
    }

    function bestFromSrcset(str) {
      if (!str) return null;
      let best = null;
      let bestScore = -1;
      str.split(',').forEach((part) => {
        const bits = part.trim().split(/\s+/);
        if (!bits[0]) return;
        const d = bits[1] || '';
        const score = parseFloat(d) || 0;
        if (score >= bestScore) {
          bestScore = score;
          best = bits[0];
        }
      });
      return best;
    }

    // All candidate URLs for an <img>, highest-quality attributes first.
    function imgCandidates(img) {
      const attrs = [
        'data-zoom-src',
        'data-large_image',
        'data-old-hires',
        'data-a-hires',
        'data-src-delay',
        'data-original',
        'data-lazy-src',
        'data-src'
      ];
      const out = [];
      attrs.forEach((a) => {
        const v = img.getAttribute(a);
        if (v) out.push(v);
      });
      const ss = bestFromSrcset(img.getAttribute('srcset') || img.getAttribute('data-srcset'));
      if (ss) out.push(ss);
      if (img.currentSrc) out.push(img.currentSrc);
      const src = img.getAttribute('src');
      if (src) out.push(src);
      return out.map(abs).filter(Boolean);
    }

    function eachImg(selector, fn) {
      document.querySelectorAll(selector).forEach((img) => {
        if (img.tagName === 'IMG') fn(img, imgCandidates(img));
      });
    }

    function extractBalanced(str, start) {
      const open = str[start];
      const close = open === '[' ? ']' : '}';
      let depth = 0;
      let inStr = false;
      let q = '';
      for (let i = start; i < str.length; i++) {
        const c = str[i];
        if (inStr) {
          if (c === '\\') i++;
          else if (c === q) inStr = false;
        } else if (c === '"' || c === "'") {
          inStr = true;
          q = c;
        } else if (c === open) depth++;
        else if (c === close) {
          depth--;
          if (depth === 0) return str.slice(start, i + 1);
        }
      }
      return null;
    }

    function ldImages() {
      const out = [];
      const walk = (o) => {
        if (!o) return;
        if (Array.isArray(o)) return o.forEach(walk);
        if (typeof o !== 'object') return;
        const t = o['@type'];
        const isProduct = t === 'Product' || (Array.isArray(t) && t.includes('Product'));
        if (isProduct && o.image) {
          [].concat(o.image).forEach((i) => out.push(typeof i === 'string' ? i : i && (i.url || i.contentUrl)));
        }
        if (o['@graph']) walk(o['@graph']);
      };
      document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
        try {
          walk(JSON.parse(s.textContent));
        } catch (e) {}
      });
      return out.map(abs).filter(Boolean);
    }

    const stripAliSuffix = (u) => u.replace(/(\.(?:jpe?g|png|webp|avif))_[^/]*$/i, '$1');
    const stripQuery = (u) => u.split('?')[0];

    // ---------- site detection ----------
    let site = 'Generic';
    if (/(^|\.)amazon\.[a-z.]+$/.test(host)) site = 'Amazon';
    else if (/(^|\.)walmart\.[a-z.]+$/.test(host)) site = 'Walmart';
    else if (/(^|\.)ebay\.[a-z.]+$/.test(host)) site = 'eBay';
    else if (/(^|\.)etsy\.com$/.test(host)) site = 'Etsy';
    else if (/(^|\.)aliexpress\.[a-z.]+$/.test(host)) site = 'AliExpress';
    else if (/(^|\.)alibaba\.com$/.test(host)) site = 'Alibaba';
    else if (
      window.Shopify ||
      document.querySelector('link[href*="cdn.shopify.com"], script[src*="cdn.shopify.com"], meta[name="shopify-checkout-api-token"]')
    )
      site = 'Shopify';
    else if (
      document.body &&
      (document.body.classList.contains('woocommerce') ||
        document.querySelector('.woocommerce-product-gallery, form.variations_form, .woocommerce div.product'))
    )
      site = 'WooCommerce';

    let title =
      (document.querySelector('#productTitle, h1') || {}).textContent ||
      document.title ||
      '';
    title = title.replace(/\s+/g, ' ').trim();

    // ---------- per-site extractors ----------
    if (site === 'Amazon') {
      const html = document.documentElement.innerHTML;
      const idx = html.indexOf("'colorImages'");
      const idx2 = idx < 0 ? html.indexOf('"colorImages"') : idx;
      if (idx2 >= 0) {
        const initIdx = html.indexOf('initial', idx2);
        const arrStart = initIdx >= 0 ? html.indexOf('[', initIdx) : -1;
        // The array may be wrapped, e.g. 'initial': A.$.parseJSON('[{...}]')
        if (arrStart >= 0 && arrStart - initIdx < 80) {
          const raw = extractBalanced(html, arrStart);
          if (raw) {
            try {
              const fullRes = (u) => u.replace(/\._[^/]*_\.(jpe?g|png|webp)(\?.*)?$/i, '.$1');
              JSON.parse(raw.replace(/\\'/g, "'")).forEach((it) => {
                let u = it.hiRes || it.large;
                if (!u && it.main) {
                  let bestA = 0;
                  Object.entries(it.main).forEach(([k, v]) => {
                    const a = (v[0] || 0) * (v[1] || 0);
                    if (a >= bestA) {
                      bestA = a;
                      u = k;
                    }
                  });
                }
                // Try the original full-resolution file first, then hiRes/large.
                if (u) add(fullRes(u), u, it.large, it.thumb);
              });
            } catch (e) {}
          }
        }
      }
      if (!items.length) {
        const main = document.querySelector('#landingImage, #imgBlkFront, #main-image');
        const dyn = main && main.getAttribute('data-a-dynamic-image');
        if (dyn) {
          try {
            const o = JSON.parse(dyn);
            const best = Object.entries(o).sort((a, b) => b[1][0] * b[1][1] - a[1][0] * a[1][1])[0];
            if (best) add(best[0]);
          } catch (e) {}
        }
        const up = (u) => u.replace(/\._[^/]*_\.(jpe?g|png|webp)(\?.*)?$/i, '.$1');
        eachImg('#altImages li:not(.videoThumbnail) img, #imageBlock img', (img, c) => {
          if (c[0]) add(up(c[0]), ...c);
        });
      }
    } else if (site === 'Walmart') {
      const nd = document.getElementById('__NEXT_DATA__');
      if (nd) {
        try {
          const data = JSON.parse(nd.textContent);
          let found = null;
          const walk = (o, depth) => {
            if (found || !o || typeof o !== 'object' || depth > 12) return;
            if (o.imageInfo && Array.isArray(o.imageInfo.allImages)) {
              found = o.imageInfo.allImages;
              return;
            }
            for (const k in o) walk(o[k], depth + 1);
          };
          walk(data, 0);
          (found || []).forEach((i) => i && i.url && add(stripQuery(i.url), i.url));
        } catch (e) {}
      }
      if (!items.length) {
        eachImg(
          '[data-testid="media-thumbnail"] img, [data-testid="hero-image-container"] img, [data-testid="vertical-carousel-container"] img, .hover-zoom-hero-image',
          (img, c) => c[0] && add(stripQuery(c[0]), ...c)
        );
      }
    } else if (site === 'eBay') {
      const up = (u) => u.replace(/\/s-l\d+\.(jpe?g|png|webp)/i, '/s-l1600.$1');
      eachImg(
        '.ux-image-carousel-item img, .ux-image-filmstrip-carousel-item img, #icImg, .vim.x-photos img, [class*="image-treatment"] img',
        (img, c) => {
          const good = c.filter((u) => /ebayimg\.com/.test(u));
          if (good[0]) add(up(good[0]), ...good);
        }
      );
      if (!items.length) {
        const html = document.documentElement.innerHTML;
        const re = /"maxImageUrl":"(https:[^"]+)"/g;
        let m;
        while ((m = re.exec(html))) add(m[1].replace(/\\u002F/g, '/').replace(/\\\//g, '/'));
      }
    } else if (site === 'Etsy') {
      const up = (u) => u.replace(/il_[0-9a-z]+x[0-9a-zN]+/i, 'il_fullxfull');
      eachImg(
        '.listing-page-image-carousel-component img, [data-carousel-pane] img, ul.carousel-pane-list img, [data-appears-component-name="listing_page_image_carousel"] img, [data-component="listing-page-image-carousel"] img',
        (img, c) => {
          const good = c.filter((u) => /etsystatic\.com/.test(u));
          if (good[0]) add(up(good[0]), ...good);
        }
      );
      if (!items.length) ldImages().forEach((u) => add(up(u), u));
    } else if (site === 'AliExpress') {
      const html = document.documentElement.innerHTML;
      const m = html.match(/"imagePathList"\s*:\s*(\[[^\]]*\])/);
      if (m) {
        try {
          JSON.parse(m[1]).forEach((u) => add(stripAliSuffix(u), u));
        } catch (e) {}
      }
      if (!items.length) {
        eachImg(
          '[class*="slider"] img, [class*="magnifier"] img, [class*="image-view"] img, [class*="images-view"] img, [class*="gallery"] img',
          (img, c) => {
            const good = c.filter((u) => /alicdn\.com|aliexpress-media/.test(u));
            if (good[0]) add(stripAliSuffix(good[0]), ...good);
          }
        );
      }
    } else if (site === 'Alibaba') {
      eachImg(
        '.id-list img, [class*="image-list"] img, [class*="main-image"] img, [class*="gallery"] img, [data-testid="media-image"], [class*="thumb"] img',
        (img, c) => {
          const good = c.filter((u) => /alicdn\.com|alibaba/.test(u));
          if (good[0]) add(stripAliSuffix(good[0]), ...good);
        }
      );
      if (!items.length) {
        const html = document.documentElement.innerHTML;
        const re = /"(?:imageUrl|imgUrl|fullPathImageURI)"\s*:\s*"((?:https?:)?\\?\/\\?\/[^"]+)"/g;
        let mm;
        while ((mm = re.exec(html))) {
          const u = mm[1].replace(/\\\//g, '/');
          add(stripAliSuffix(u), u);
        }
      }
      if (!items.length) ldImages().forEach((u) => add(stripAliSuffix(u), u));
    } else if (site === 'Shopify') {
      const orig = (u) =>
        u.replace(/_(\d+x\d*|x\d+|pico|icon|thumb|small|compact|medium|large|grande|master)(?=\.\w+(\?|$))/i, '');
      const m = location.pathname.match(/^(.*\/products\/[^/?#]+)/);
      if (m) {
        try {
          const r = await fetch(m[1] + '.js', { credentials: 'same-origin' });
          if (r.ok) {
            const p = await r.json();
            const urls = [];
            (p.media || []).forEach((x) => x && x.media_type === 'image' && x.src && urls.push(x.src));
            (p.images || []).forEach((u) => urls.push(typeof u === 'string' ? u : u && u.src));
            urls.forEach((u) => {
              const a = abs(u);
              if (a) add(orig(a), a);
            });
            if (p.title) title = p.title;
          }
        } catch (e) {}
      }
      if (!items.length) {
        ldImages().forEach((u) => add(orig(u), u));
        eachImg('[class*="product"] img, [class*="gallery"] img, [class*="media"] img', (img, c) => {
          if (c[0] && /cdn\.shopify\.com/.test(c[0])) add(orig(c[0]), ...c);
        });
      }
    } else if (site === 'WooCommerce') {
      const unsize = (u) => u.replace(/-\d+x\d+(?=\.\w+(\?|$))/, '');
      document.querySelectorAll('.woocommerce-product-gallery__image').forEach((div) => {
        const a = div.querySelector('a[href]');
        const img = div.querySelector('img');
        const c = img ? imgCandidates(img) : [];
        const full = a && abs(a.getAttribute('href'));
        if (full && /\.(jpe?g|png|webp|avif)(\?|$)/i.test(full)) add(full, ...c);
        else if (c[0]) add(unsize(c[0]), ...c);
      });
      const form = document.querySelector('form.variations_form[data-product_variations]');
      if (form) {
        try {
          JSON.parse(form.getAttribute('data-product_variations')).forEach((v) => {
            if (v && v.image) {
              const u = v.image.full_src || v.image.src;
              if (u) add(u, v.image.src);
            }
          });
        } catch (e) {}
      }
      if (!items.length) {
        ldImages().forEach((u) => add(unsize(u), u));
        eachImg('.woocommerce-product-gallery img, .product img', (img, c) => c[0] && add(unsize(c[0]), ...c));
      }
    }

    // ---------- generic fallback (unknown sites or nothing found) ----------
    if (!items.length) {
      ldImages().forEach((u) => add(u));
      const og = document.querySelector('meta[property="og:image"], meta[name="og:image"]');
      if (og) add(og.getAttribute('content'));
      document.querySelectorAll('img').forEach((img) => {
        const w = Math.max(img.naturalWidth || 0, img.clientWidth || 0);
        const h = Math.max(img.naturalHeight || 0, img.clientHeight || 0);
        if (w < 250 || h < 250) return;
        const c = imgCandidates(img).filter((u) => !/\.(svg|gif)(\?|$)/i.test(u));
        if (c[0]) add(c[0], ...c);
      });
    }

    return { site, title, images: items };
  };
})();
