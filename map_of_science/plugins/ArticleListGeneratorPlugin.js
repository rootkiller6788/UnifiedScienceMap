const fs = require("fs");
const path = require("path");

class ArticleListGeneratorPlugin {
  constructor(options) {
    this.options = options || {};
  }

  apply(compiler) {
    compiler.hooks.emit.tapAsync(
      "ArticleListGeneratorPlugin",
      (compilation, callback) => {
        const articlesDir = path.resolve(__dirname, this.options.articlesPath);
        fs.readdir(articlesDir, (err, files) => {
          if (err) {
            return callback(err);
          }

          const articles = files.filter((file) => file.endsWith(".html"));
          const output = JSON.stringify(articles, null, 2);

          compilation.assets["articlesList.json"] = {
            source: () => output,
            size: () => output.length,
          };

          callback();
        });
      },
    );
  }
}

module.exports = ArticleListGeneratorPlugin;
