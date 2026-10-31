/* Static wiring check: every element id a page script reaches for must exist
   in the page, and every page must load the shared scripts in the right order. */
const fs = require('fs');
const path = require('path');
const root = process.argv[2] || process.cwd();

const PAGES = ['index.html', 'dashboard.html', 'attendance.html', 'classes.html', 'teachers.html',
  'students.html', 'planner.html', 'reports.html', 'settings.html', 'examinations.html'];

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

function idsIn(html) {
  const set = new Set();
  const re = /\bid="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) set.add(m[1]);
  return set;
}
function scriptOrder(html) {
  const re = /<script[^>]*src="([^"]+)"/g;
  const out = [];
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

const PAIRS = [
  ['js/students.js', 'students.html'],
  ['js/exams.js', 'examinations.html'],
  ['js/print.js', 'students.html'],
  ['js/attendance.js', 'attendance.html'],
  ['js/reports.js', 'reports.html'],
  ['js/dashboard.js', 'dashboard.html'],
  ['js/classes.js', 'classes.html'],
  ['js/teachers.js', 'teachers.html'],
  ['js/planner.js', 'planner.html'],
  ['js/settings.js', 'settings.html']
];

for (const [js, html] of PAIRS) {
  const jsPath = path.join(root, js);
  const htmlPath = path.join(root, html);
  if (!fs.existsSync(jsPath) || !fs.existsSync(htmlPath)) { console.log('  SKIP  ' + js + ' / ' + html); continue; }
  const src = fs.readFileSync(jsPath, 'utf8');
  const page = fs.readFileSync(htmlPath, 'utf8');
  const have = idsIn(page);

  const wanted = new Set();
  let m;
  const re1 = /getElementById\(\s*'([^']+)'\s*\)/g;
  while ((m = re1.exec(src))) wanted.add(m[1]);
  const re2 = /getElementById\(\s*"([^"]+)"\s*\)/g;
  while ((m = re2.exec(src))) wanted.add(m[1]);
  const re3 = /querySelector\(\s*'#([A-Za-z0-9_-]+)'\s*\)/g;
  while ((m = re3.exec(src))) wanted.add(m[1]);

  /* Exam tabs and the print shell are built at runtime. */
  if (js === 'js/exams.js') {
    wanted.clear();
    wanted.add('examTabbar');
    wanted.add('examContent');
  }
  if (js === 'js/print.js') wanted.clear();

  /* classes.js refreshes selects that only exist on other pages. */
  if (js === 'js/classes.js') {
    wanted.delete('studentClassFilter');
    wanted.delete('attClassSelect');
  }

  const missing = [...wanted].filter(id => !have.has(id));
  check(js + ' -> ' + html + ': all ' + wanted.size + ' element ids exist', missing.length === 0, missing);

  const order = scriptOrder(page);
  const appAt = order.indexOf('js/app.js');
  const pageAt = order.indexOf(js);
  check(html + ' loads ' + js + ' after js/app.js', appAt >= 0 && pageAt > appAt, order);
}

/* every page must load the shared core in the same order */
for (const page of PAGES) {
  const p = path.join(root, page);
  if (!fs.existsSync(p)) { console.log('  SKIP  ' + page); continue; }
  const html = fs.readFileSync(p, 'utf8');
  const order = scriptOrder(html);
  const iPhotos = order.indexOf('js/photos.js');
  const iApp = order.indexOf('js/app.js');
  check(page + ' loads js/photos.js before js/app.js', iPhotos >= 0 && iApp > iPhotos, order);
  check(page + ' loads js/app.js', iApp >= 0, order);
}

/* students.html must ship the register markup */
const studentsHtml = fs.readFileSync(path.join(root, 'students.html'), 'utf8');
const need = ['studentTableBody', 'studentForm', 'profileContent', 'registerStats', 'studentSearch',
  'studentClassFilter', 'studentSessionFilter', 'studentSort', 'studentPageSize',
  'importStudentsModal', 'pagination'];
const have = idsIn(studentsHtml);
const missing = need.filter(id => !have.has(id));
check('students.html ships the register markup', missing.length === 0, missing);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
