(function () {
  var t = localStorage.getItem('gardeticket_theme');
  var colors = { teal: '#1C7176', ocean: '#1D4ED8', indigo: '#4338CA', forest: '#15803D', plum: '#7E22CE', magenta: '#A21CAF', crimson: '#BE123C', slate: '#334155' };
  if (t && colors[t]) {
    document.documentElement.dataset.theme = t;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', colors[t]);
  }
})();
