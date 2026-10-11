// Builds both editions from the one set of source files.
//   build/sky3d.html          the home edition: this receiver's antenna only
//   build/sky3d-network.html  the network edition: the antenna joined by a public flight network
const esbuild = require('esbuild'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const safe = (s) => s.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const geo = fs.readFileSync(path.join(root, 'build/geo.json'), 'utf8').replace(/</g, '\\u003c');
const airports = fs.readFileSync(path.join(root, 'build/airports.json'), 'utf8').replace(/</g, '\\u003c');
for (const [name, net, edition] of [['sky3d.html', false, 'home edition'], ['sky3d-network.html', true, 'network edition']]) {
  // __NET__ is fixed here, so in the home edition every network part is dropped from the code, not merely switched off
  esbuild.buildSync({ entryPoints: [path.join(root, 'src/main.js')], bundle: true, minify: true, format: 'iife', target: ['es2018'], outfile: path.join(root, 'build/app.js'), legalComments: 'none', define: { __NET__: String(net) } });
  let html = fs.readFileSync(path.join(root, 'src/template.html'), 'utf8');
  const keep = net ? 'NET' : 'HOME', drop = net ? 'HOME' : 'NET';
  html = html.replace(new RegExp('<!--' + drop + '-->[\\s\\S]*?<!--/' + drop + '-->\\n?', 'g'), '').replace(new RegExp('<!--/?' + keep + '-->', 'g'), '').split('/*EDITION*/').join(edition);
  const put = (tag, text) => { const i = html.indexOf(tag); html = html.slice(0, i) + text + html.slice(i + tag.length); };
  put('/*GEO*/', geo); put('/*AIRPORTS*/', airports); put('/*APP*/', safe(fs.readFileSync(path.join(root, 'build/app.js'), 'utf8')));
  fs.writeFileSync(path.join(root, 'build', name), html);
  console.log(name, (html.length / 1024).toFixed(0) + ' KB');
}
