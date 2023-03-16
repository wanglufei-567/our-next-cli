// javascript-stringify 用于格式化 js 对象等变量的显示
const { stringifyJS } = require('./util/util');

/**
 * @description ConfigTransform类
 * 用于获取配置文件名及内容，并转换内容为文本
 * 配置文件名可能是js后缀的文件，json后缀的文件，或yaml后缀的文件，
 * 暂只考虑js后缀的配置文件
 *
 * 这里使用了单例模式，每一种配置文件只有一个ConfigTransform实例化对象
 * 比如vue.config.js有一个ConfigTransform
 * babel.config.js有一个ConfigTransform
 */
class ConfigTransform {
  // 文件信息
  constructor(options) {
    this.fileDescriptor = options;
  }

  // value 文件内容
  /**
   * @description 将配置文件的信息写入相应的配置文件中
   */
  transform(value) {
    let file = this.getDefaultFile();
    const { type, filename } = file;

    if (type !== 'js') {
      throw new Error('哎呀，出错了，仅支持 js 后缀的配置文件');
    }

    const content = this.getContent(value, filename);

    return {
      filename,
      content
    };
  }

  getContent(value, filename) {
    if (filename === 'vue.config.js') {
      return (
        `const { defineConfig } = require('@vue/cli-service')\n` +
        `module.exports = defineConfig(${stringifyJS(
          value,
          null,
          2
        )})`
      );
    } else {
      return `module.exports = ${stringifyJS(value, null, 2)}`;
    }
  }

  // 获取 fileDescriptor 第1个对象作为 type 和 filename
  getDefaultFile() {
    const [type] = Object.keys(this.fileDescriptor);
    const [filename] = this.fileDescriptor[type];
    return { type, filename };
  }
}

module.exports = ConfigTransform;
