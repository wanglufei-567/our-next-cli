const inquirer = require('inquirer');
const {
  chalk,
  log,
  hasGit,
  hasProjectGit,
  execa,
  loadModule
} = require('@vue/cli-shared-utils');
const PromptModuleAPI = require('./PromptModuleAPI');
const PackageManager = require('./PackageManager');
const Generator = require('./Generator.js');
const { defaults } = require('./util/preset');
const { vuePresets } = require('./util/preset');
const { getPromptModules } = require('./util/prompt');
const {
  writeFileTree,
  sortObject,
  generateReadme
} = require('./util/util.js');

class Creator {
  constructor(name, context) {
    // 项目名称
    this.name = name;
    // 项目路径，含名称
    this.context = process.env.VUE_CLI_CONTEXT = context;
    // package.json 数据
    this.pkg = {};
    // 包管理工具
    this.pm = null;
    // 预设提示选项
    this.presetPrompt = this.resolvePresetPrompts();
    // 自定义特性提示选项（复选框）
    this.featurePrompt = this.resolveFeaturePrompts();
    // 保存相关提示选项
    this.outroPrompts = this.resolveOutroPrompts();
    // 其他提示选项
    this.injectedPrompts = [];
    // 回调
    this.promptCompleteCbs = [];

    const promptAPI = new PromptModuleAPI(this);
    const promptModules = getPromptModules();
    promptModules.forEach(m => m(promptAPI));

    // 测试（仅为测试代码，用完需删除）
    // console.log('prompts', JSON.stringify(this.resolveFinalPrompts()))
    // inquirer.prompt(this.resolveFinalPrompts()).then(res => {
    //   console.log('选择的选项：')
    //   console.log(res)
    //   // {
    //   //   preset: '__manual__',
    //   //   features: [ 'babel', 'router' ],
    //   //   useConfigFiles: 'files',
    //   //   save: true,
    //   //   saveName: 'ownerPreset',
    //   //   historyMode: true
    //   // }
    // })
  }

  /**
   * @description 创建项目的方法 （核心方法）
   */
  async create() {
    // 获取用户选择的配置项
    const preset = await this.promptAndResolvePreset();
    await this.initPackageManagerEnv(preset);
    const generator = await this.generate(preset);
    await this.generateReadme(generator);
    this.finished();

    // 测试（仅为测试代码，用完需删除）
    // console.log('preset 值：');
    // console.log(preset);
  }

  /**
   * @description 将所有配置项合并
   */
  resolveFinalPrompts() {
    const prompts = [
      this.presetPrompt,
      this.featurePrompt,
      ...this.outroPrompts,
      ...this.injectedPrompts
    ];
    return prompts;
  }

  // 获得预设的选项
  resolvePresetPrompts() {
    const presetChoices = Object.entries(defaults.presets).map(
      ([name, preset]) => {
        return {
          name: `${name}(${Object.keys(preset.plugins).join(',')})`, // 将预设的插件放到提示
          value: name
        };
      }
    );

    return {
      name: 'preset', // preset 记录用户选择的选项值。
      type: 'list', // list 表单选
      message: `Please pick a preset:`,
      choices: [
        ...presetChoices, // Vue2 默认配置，Vue3 默认配置
        {
          name: 'Manually select features', // 手动选择配置，自定义特性配置
          value: '__manual__'
        }
      ]
    };
  }

  // 自定义特性复选框
  resolveFeaturePrompts() {
    return {
      name: 'features', // features 记录用户选择的选项值。
      when: answers => answers.preset === '__manual__', // 当选择"Manually select features"时，该提示显示
      type: 'checkbox',
      message: 'Check the features needed for your project:',
      choices: [], // 复选框值，待补充
      pageSize: 10
    };
  }

  // 保存相关提示选项
  resolveOutroPrompts() {
    const outroPrompts = [
      // useConfigFiles 是单选框提示选项。
      {
        name: 'useConfigFiles',
        when: answers => answers.preset === '__manual__',
        type: 'list',
        message:
          'Where do you prefer placing config for Babel, ESLint, etc.?',
        choices: [
          {
            name: 'In dedicated config files',
            value: 'files'
          },
          {
            name: 'In package.json',
            value: 'pkg'
          }
        ]
      },
      // 确认提示选项
      {
        name: 'save',
        when: answers => answers.preset === '__manual__',
        type: 'confirm',
        message: 'Save this as a preset for future projects?',
        default: false
      },
      // 输入提示选项
      {
        name: 'saveName',
        when: answers => answers.save,
        type: 'input',
        message: 'Save preset as:'
      }
    ];
    return outroPrompts;
  }

  /**
   * @description 处理用户选择的配置项
   */
  async promptAndResolvePreset() {
    try {
      let preset;
      const { name } = this;
      const answers = await inquirer.prompt(
        this.resolveFinalPrompts()
      );

      // answers 得到的值为 { preset: 'Default (Vue 2)' }

      if (answers.preset && answers.preset === 'Default (Vue 2)') {
        if (answers.preset in vuePresets) {
          preset = vuePresets[answers.preset];
        }
      } else {
        // 暂不支持 Vue3、自定义特性配置情况
        throw new Error(
          '哎呀，出错了，暂不支持 Vue3、自定义特性配置情况'
        );
      }

      // 添加 projectName 属性
      preset.plugins['@vue/cli-service'] = Object.assign(
        {
          projectName: name
        },
        preset
      );

      return preset;
    } catch (err) {
      console.log(chalk.red(err));
      process.exit(1);
    }
  }

  /**
   * @description 安装依赖包、初始化git
   */
  async initPackageManagerEnv(preset) {
    const { name, context } = this;
    this.pm = new PackageManager({ context });

    // 打印提示
    log(`✨ 创建项目：${chalk.yellow(context)}`);

    // 用于生成 package.json 文件
    const pkg = {
      name,
      version: '0.1.0',
      private: true,
      devDependencies: {}
    };

    // 给 npm 包指定版本，简单做，使用最新的版本
    const deps = Object.keys(preset.plugins);
    deps.forEach(dep => {
      let { version } = preset.plugins[dep];
      if (!version) {
        version = 'latest';
      }
      pkg.devDependencies[dep] = version;
    });

    this.pkg = pkg;

    // 创建package.json文件，并将配置信息写入
    await writeFileTree(context, {
      'package.json': JSON.stringify(pkg, null, 2)
    });

    // 初始化git仓库，以至于vue-cli-service可以设置 git hooks
    const shouldInitGit = this.shouldInitGit();
    if (shouldInitGit) {
      log(`🗃 初始化 Git 仓库...`);
      await this.run('git init');
    }

    // 安装插件 plugins
    log(`⚙ 正在安装 CLI plugins. 请稍候...`);

    await this.pm.install();
  }

  /**
   * @description 执行脚本
   */
  run(command, args) {
    if (!args) {
      // 按照空格分割
      [command, ...args] = command.split(/\s+/);
    }
    return execa(command, args, { cwd: this.context });
  }

  /**
   * @description 判断是否可以初始化git仓库
   * 若系统安装了git且当前目录下未初始化过git
   * 则初始化
   */
  shouldInitGit() {
    if (!hasGit()) {
      // 系统未安装 git
      return false;
    }

    // 项目未初始化 Git
    return !hasProjectGit(this.context);
  }

  /**
   * @description generate方法用于生成项目文件
   * 如vue文件，js文件，css文件，babel配置文件，eslint配置文件
   */
  async generate(preset) {
    log(`🚀 准备相关文件...`);
    const { pkg, context } = this;

    // plugins: 获取插件信息。每个插件独立实现文件模板，完成生成相关文件的功能
    const plugins = await this.resolvePlugins(preset.plugins, pkg);

    // generator: 实例化Generator，Generator具有生成文件的能力
    const generator = new Generator(context, {
      pkg,
      plugins
    });

    // generator.generate: 依据文件模板，生成文件
    await generator.generate({
      extractConfigFiles: preset.useConfigFiles // false
    });
    log(`🚀 相关文件已写入磁盘！`);

    await this.pm.install();

    return generator;
  }

  /**
   * @description 获取插件信息
   * 每个插件都有一个generator模块，独立实现文件模板，实现生成相关文件的功能
   * resolvePlugins方法把generator模块引入过来
   * 定义为apply方法，放到preset.plugins里
   */
  async resolvePlugins(rawPlugins) {
    // 插件排序，@vue/cli-service 排第1个
    rawPlugins = sortObject(rawPlugins, ['@vue/cli-service'], true);
    const plugins = [];

    for (const id of Object.keys(rawPlugins)) {
      /**
       * loadModule方法返回一个类似于require方法的函数
       * 用于导入插件的 generator 模块
       *
       * require('@vue/cli-service/generator')
       * @vue/cli-service用于生成项目文件和vue.config.js
       *
       * require('@vue/cli-plugin-babel/generator')
       * @vue/cli-plugin-babel生成babel配置文件
       *
       * require('@vue/cli-plugin-eslint/generator')
       * @vue/cli-plugin-eslint生成eslint配置文件
       */
      const apply =
        loadModule(`${id}/generator`, this.context) || (() => {});
      let options = rawPlugins[id] || {};
      plugins.push({ id, apply, options });
    }

    // plugins = [
    //   {
    //     id: '@vue/cli-service',
    //     apply: [Function (anonymous)],
    //     options: {
    //       projectName: 'demo',
    //       vueVersion: '2',
    //       useConfigFiles: false,
    //       cssPreprocessor: undefined,
    //       plugins: [Object]
    //     }
    //   },
    //   {
    //     id: '@vue/cli-plugin-babel',
    //     apply: [Function (anonymous)],
    //     options: {}
    //   },
    //   {
    //     id: '@vue/cli-plugin-eslint',
    //     apply: [Function (anonymous)] {
    //       hooks: [Function (anonymous)],
    //       applyTS: [Function (anonymous)]
    //     },
    //     options: { config: 'base', lintOn: [Array] }
    //   }
    // ]
    return plugins;
  }

  /**
   * @description 生成readme文件
   */
  async generateReadme(generator) {
    log();
    log('📄 正在生成 README.md...');
    const { context } = this;
    await writeFileTree(context, {
      'README.md': generateReadme(generator.pkg)
    });
  }

  /**
   * @description 提示项目生成完成
   */
  finished() {
    const { name } = this;
    log(`🎉 成功创建项目 ${chalk.yellow(name)}.`);
    log(
      `👉 用以下命令启动项目 :\n\n` +
        chalk.cyan(`cd ${name}\n`) +
        chalk.cyan(`npm run serve`)
    );
  }
}

module.exports = Creator;
