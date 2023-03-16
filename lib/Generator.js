const PackageManager = require('./PackageManager');
const ConfigTransform = require('./ConfigTransform');
const GeneratorAPI = require('./GeneratorAPI');
const { sortObject, writeFileTree } = require('./util/util.js');

/**
 * defaultConfigTransforms 是配置文件信息
 * 定义了各个配置文件的默认名字
 * ConfigTransform 用于获取配置文件名及内容
 */
const defaultConfigTransforms = {
  vue: new ConfigTransform({
    js: ['vue.config.js']
  }),
  babel: new ConfigTransform({
    js: ['babel.config.js']
  }),
  postcss: new ConfigTransform({
    js: ['postcss.config.js']
  }),
  eslintConfig: new ConfigTransform({
    js: ['.eslintrc.js']
  }),
  jest: new ConfigTransform({
    js: ['jest.config.js']
  }),
  'lint-staged': new ConfigTransform({
    js: ['lint-staged.config.js']
  })
};

/**
 * @description Generator 类用于生成项目文件，配置文件
 * 主要是generate方法的实现，外部通过调用generate方法来生成文件
 */
class Generator {
  constructor(context, { pkg = {}, plugins = [], files = {} } = {}) {
    // 目标目录即准备新建的项目目录
    this.context = context;

    // 插件信息：
    // [{id: '@vue/cli-service', apply: [Function], options: {...}}, ...]
    this.plugins = plugins;

    // 由Creator实例传进来的pkg，为项目目录package.json数据对象
    this.originalPkg = pkg;

    this.pkg = Object.assign({}, pkg);

    // 实例化 PackageManager
    this.pm = new PackageManager({ context });
    this.rootOptions = {};

    // 记录 babel, vue 等配置文件默认名字，并提供了提取文件内容的能力
    this.defaultConfigTransforms = defaultConfigTransforms;

    // 文件信息，用于生成项目文件配置文件
    this.files = files;
    this.fileMiddlewares = [];
    this.exitLogs = [];

    // @vue/cli-service 插件
    const cliService = plugins.find(p => p.id === '@vue/cli-service');
    const rootOptions = cliService.options;
    this.rootOptions = rootOptions;
  }

  /**
   * 提取信息，写入磁盘
   * 主要步骤：
   * 1、initPlugins准备工作，提取配置信息到pkg(即Creator实例的 pkg)，项目文件生成准备工作
   * 2、extractConfigFiles将pkg (即 package.json) 中的一些配置提取到专用文件中
   * 3、resolveFiles 提取文件内容
   * 4、更新 package.json 数据，生成项目文件，配置文件
   */
  async generate({
    extractConfigFiles = false,
    checkExisting = false,
    sortPackageJson = true
  } = {}) {
    // 准备工作
    await this.initPlugins();

    // 将 package.json 中的一些配置提取到专用文件中。
    this.extractConfigFiles(extractConfigFiles, checkExisting);

    // 提取文件内容
    await this.resolveFiles();

    // pkg 字段排序
    if (sortPackageJson) {
      this.sortPkg();
    }

    // 更新 package.json 数据
    this.files['package.json'] =
      JSON.stringify(this.pkg, null, 2) + '\n';

    // 生成项目文件，配置文件
    await writeFileTree(this.context, this.files);
  }

  /**
   * @description 运行前面导入的模块
   * @vue/cli-service/generator
   * @vue/cli-plugin-babel/generator
   * @vue/cli-plugin-eslint/generator
   * 提取相关信息到 pkg，files。
   */
  async initPlugins() {
    const { rootOptions } = this;

    for (const plugin of this.plugins) {
      const { id, apply, options } = plugin;
      const api = new GeneratorAPI(id, this, options, rootOptions);

      /**
       * 运行apply(api, options, rootOptions, {}) 等于运行
       * @vue/cli-service/generator
       * @vue/cli-plugin-babel/generator
       * @vue/cli-plugin-eslint/generator等模块
       * 这些模块调用了GeneratorAPI 的 render，extendPackage 方法
       *
       * api 为 GeneratorAPI 实例
       *
       * api.render方法将插件模块目录下文件信息
       * 包装成middleware暂存到fileMiddlewares，
       * middleware 执行时提取项目文件信息
       *
       * api.extendPackage方法是把配置文件信息记录到pkg
       */
      await apply(api, options, rootOptions, {});
    }
  }

  /**
   * @description 提取package.json的vue、babel配置信息到files对象
   * key 为 vue.config.js, babel.config.js
   */
  extractConfigFiles() {
    const ensureEOL = str => {
      if (str.charAt(str.length - 1) !== '\n') {
        return str + '\n';
      }
      return str;
    };

    const extract = key => {
      const value = this.pkg[key];
      const configTransform = this.defaultConfigTransforms[key];
      // 用于处理配置文件名称，文件内容，并记录到 this.files
      const res = configTransform.transform(
        value,
        false,
        this.files,
        this.context
      );
      const { content, filename } = res;
      this.files[filename] = ensureEOL(content);
      // this.files['babel.config.js'] = 文件内容
      // this.files['vue.config.js'] = 文件内容
    };

    // 提取 vue, babel 配置文件名称及其内容
    extract('vue');
    extract('babel');
  }

  /**
   * @description 提取vue的项目文件名及内容
   */
  async resolveFiles() {
    for (const middleware of this.fileMiddlewares) {
      await middleware(this.files);
    }
  }

  /**
   * @description 对pkg对象顺序进行调整
   * 更新package.json文件内容，项目文件，配置文件写入磁盘
   */
  sortPkg() {
    // 默认排序
    this.pkg.dependencies = sortObject(this.pkg.dependencies);
    this.pkg.devDependencies = sortObject(this.pkg.devDependencies);

    // 按 serve, build... 排序
    this.pkg.scripts = sortObject(this.pkg.scripts, [
      'serve',
      'build',
      'test:unit',
      'test:e2e',
      'lint',
      'deploy'
    ]);

    // 按 name version... 排序
    this.pkg = sortObject(this.pkg, [
      'name',
      'version',
      'private',
      'description',
      'author',
      'scripts',
      'main',
      'module',
      'browser',
      'jsDelivr',
      'unpkg',
      'files',
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'vue',
      'babel',
      'eslintConfig',
      'prettier',
      'postcss',
      'browserslist',
      'jest'
    ]);
  }
}

module.exports = Generator;
