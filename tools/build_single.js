/* Builds dist/exam-studio.html: one self-contained file (CSS + JS inlined). Opens by double-click; no server needed.
   (The installable/offline PWA version is the multi-file folder served over https or localhost.) */
const fs = require('fs'), path = require('path'); const r = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
let html = r('index.html');
html = html.replace(/<link rel="manifest"[^>]*>\n?/, '').replace(/<link rel="icon"[^>]*>\n?/, '').replace(/<link rel="apple-touch-icon"[^>]*>\n?/, '');
html = html.replace('<link rel="stylesheet" href="css/styles.css">', '<style>\n' + r('css/styles.css') + '\n</style>');
['core', 'i18n', 'db', 'app'].forEach(f => { html = html.replace('<script src="js/' + f + '.js"></script>', '<script>\n' + r('js/' + f + '.js').replace(/<\/script>/g, '<\\/script>') + '\n</script>'); });
html = html.replace(/<script>if \("serviceWorker"[^\n]*<\/script>\n?/, '');
fs.writeFileSync(path.join(__dirname, '..', 'dist', 'exam-studio.html'), html, 'utf8');
console.log('dist/exam-studio.html', Math.round(html.length / 1024) + ' KB');
