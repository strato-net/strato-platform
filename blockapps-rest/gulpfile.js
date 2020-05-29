const { dest, series, src, task } = require("gulp");
const babel = require("gulp-babel");
const gulpClean = require("gulp-clean");
const sourcemaps = require("gulp-sourcemaps");
const exec = require("child_process").exec;

function clean() {
  return src("dist", { read: false, allowEmpty: true }).pipe(gulpClean());
}

function build() {
  return src(["lib/**/*.js", "!**/test/", "!**/test/**"])
    .pipe(sourcemaps.init())
    .pipe(babel({ presets: ["@babel/preset-env", "minify"] }))
    .pipe(sourcemaps.write(".", { sourceRoot: "/lib" }))
    .pipe(dest("dist"));
}

function generateDocs(cb) {
  exec(
    "rm -rf docs && node_modules/.bin/jsdoc -c jsdoc-conf.json -d docs",
    (err, stdout) => {
      console.log(stdout);
      cb(err);
    }
  );
}

exports.clean = clean;
exports.build = build;
exports.generateDocs = generateDocs;
exports.default = series(clean, build, generateDocs);
