// cli-commands/dom-collector.js
// Single-pass DOM data collection — runs ONE page.evaluate() to gather everything

export async function collectDOMData(page) {
  return await page.evaluate(() => {
    const data = {
      url: window.location.href,
      title: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scrollWidth: document.documentElement.scrollWidth,
      hasOverflow: document.documentElement.scrollWidth > window.innerWidth,
      elements: [],
      images: [],
      headings: [],
      links: [],
      forms: [],
      meta: {},
      interactive: [],
      textContent: [],
    };

    // Helper: is element visible?
    function isVisible(el) {
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0'
        && el.offsetWidth > 0 && el.offsetHeight > 0;
    }

    // Helper: get unique short selector
    function getSelector(el) {
      if (el.id) return `#${el.id}`;
      let s = el.tagName.toLowerCase();
      if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
      return s;
    }

    // Collect visible elements with styles (limit to avoid performance issues)
    const allElements = document.querySelectorAll('*');
    let elementCount = 0;
    const MAX_ELEMENTS = 500;

    allElements.forEach(el => {
      if (elementCount >= MAX_ELEMENTS) return;
      if (!isVisible(el)) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      const style = getComputedStyle(el);
      elementCount++;

      data.elements.push({
        selector: getSelector(el),
        tag: el.tagName.toLowerCase(),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        styles: {
          color: style.color,
          backgroundColor: style.backgroundColor,
          fontSize: style.fontSize,
          fontFamily: style.fontFamily.split(',')[0].trim().replace(/['"]/g, ''),
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
          margin: `${style.marginTop} ${style.marginRight} ${style.marginBottom} ${style.marginLeft}`,
          zIndex: style.zIndex !== 'auto' ? parseInt(style.zIndex) : null,
          position: style.position,
          overflow: style.overflow,
          textOverflow: style.textOverflow,
        },
        text: el.textContent?.trim().slice(0, 100) || '',
      });
    });

    // Images
    document.querySelectorAll('img').forEach(img => {
      data.images.push({
        src: img.src?.slice(0, 200),
        alt: img.alt,
        hasAlt: img.hasAttribute('alt'),
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        displayWidth: img.clientWidth,
        displayHeight: img.clientHeight,
        loading: img.loading,
        broken: img.naturalWidth === 0 && img.complete,
        selector: getSelector(img),
      });
    });

    // Headings
    document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => {
      data.headings.push({
        level: parseInt(h.tagName[1]),
        text: h.textContent?.trim().slice(0, 100),
        selector: getSelector(h),
      });
    });

    // Links
    document.querySelectorAll('a[href]').forEach(a => {
      data.links.push({
        href: a.href,
        text: a.textContent?.trim().slice(0, 50),
        empty: !a.textContent?.trim() && !a.querySelector('img[alt]') && !a.getAttribute('aria-label'),
        selector: getSelector(a),
      });
    });

    // Forms and inputs
    document.querySelectorAll('input,select,textarea').forEach(input => {
      if (input.type === 'hidden') return;
      const hasLabel = input.id && document.querySelector(`label[for="${input.id}"]`);
      const hasAria = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby');
      const inLabel = input.closest('label');
      data.forms.push({
        tag: input.tagName.toLowerCase(),
        type: input.type || 'text',
        name: input.name,
        hasLabel: !!(hasLabel || hasAria || inLabel || input.getAttribute('title')),
        placeholder: input.placeholder,
        required: input.required,
        selector: getSelector(input),
        rect: { w: Math.round(input.getBoundingClientRect().width), h: Math.round(input.getBoundingClientRect().height) },
      });
    });

    // Interactive elements (for tap target check)
    document.querySelectorAll('a,button,[role="button"],input,select,textarea,[tabindex]:not([tabindex="-1"])').forEach(el => {
      if (!isVisible(el)) return;
      const rect = el.getBoundingClientRect();
      data.interactive.push({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role'),
        text: (el.textContent?.trim() || el.getAttribute('aria-label') || '').slice(0, 50),
        rect: { w: Math.round(rect.width), h: Math.round(rect.height) },
        selector: getSelector(el),
      });
    });

    // Meta tags
    data.meta.title = document.title;
    data.meta.description = document.querySelector('meta[name="description"]')?.content || null;
    data.meta.canonical = document.querySelector('link[rel="canonical"]')?.href || null;
    data.meta.viewport = document.querySelector('meta[name="viewport"]')?.content || null;
    data.meta.lang = document.documentElement.lang || null;
    data.meta.ogTitle = document.querySelector('meta[property="og:title"]')?.content || null;
    data.meta.ogDescription = document.querySelector('meta[property="og:description"]')?.content || null;
    data.meta.ogImage = document.querySelector('meta[property="og:image"]')?.content || null;
    data.meta.robots = document.querySelector('meta[name="robots"]')?.content || null;

    // Buttons without text
    document.querySelectorAll('button,[role="button"]').forEach(btn => {
      if (!isVisible(btn)) return;
      const text = btn.textContent?.trim();
      const aria = btn.getAttribute('aria-label');
      const imgAlt = btn.querySelector('img[alt]')?.alt;
      if (!text && !aria && !imgAlt) {
        data.forms.push({
          tag: 'button',
          type: 'empty-button',
          hasLabel: false,
          selector: getSelector(btn),
          rect: { w: Math.round(btn.getBoundingClientRect().width), h: Math.round(btn.getBoundingClientRect().height) },
        });
      }
    });

    return data;
  });
}
