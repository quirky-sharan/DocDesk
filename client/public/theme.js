// Applied before React renders, so a dark-mode user never sees a white flash on
// load. Mirrors the logic in src/hooks/useTheme.js.
//
// A file of its own rather than a few lines in index.html: with no inline
// script anywhere, the page's content policy can refuse inline script
// altogether, and text that ends up in a page can never run as code.
try {
  var saved = localStorage.getItem('docdesk_theme');
  if (saved === 'light' || saved === 'dark') {
    document.documentElement.setAttribute('data-theme', saved);
  }
} catch (e) {}
