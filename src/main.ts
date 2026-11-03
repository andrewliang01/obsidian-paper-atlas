import { App, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { ATLAS_VIEW_TYPE, AtlasView } from './view/AtlasView';
import { AtlasSettings, DEFAULT_SETTINGS, normalizeSettings } from './settings';

export default class PaperAtlasPlugin extends Plugin {
  settings: AtlasSettings = { ...DEFAULT_SETTINGS };

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(ATLAS_VIEW_TYPE, (leaf) => new AtlasView(leaf, this));
    try {
      this.registerExtensions(['pcanvas'], ATLAS_VIEW_TYPE);
    } catch (error) {
      console.warn('Paper Atlas: 扩展名 pcanvas 已被其他插件注册', error);
    }

    this.addRibbonIcon('network', '打开论文图谱', () => {
      void this.openAtlas();
    });

    this.addCommand({
      id: 'open-atlas',
      name: '打开论文图谱',
      callback: () => {
        void this.openAtlas();
      },
    });

    this.addCommand({
      id: 'atlas-layout',
      name: '画布：按领域自动布局',
      checkCallback: (checking) => {
        const view = this.getAtlasView();
        if (!view) return false;
        if (!checking) view.autoLayoutAll();
        return true;
      },
    });

    this.addCommand({
      id: 'atlas-spread-all',
      name: '画布：铺开全部论文',
      checkCallback: (checking) => {
        const view = this.getAtlasView();
        if (!view) return false;
        if (!checking) view.spreadAllPapers();
        return true;
      },
    });

    this.addCommand({
      id: 'atlas-fit',
      name: '画布：适应视图',
      checkCallback: (checking) => {
        const view = this.getAtlasView();
        if (!view) return false;
        if (!checking) view.fitAll();
        return true;
      },
    });

    this.addCommand({
      id: 'atlas-clear',
      name: '画布：清空',
      checkCallback: (checking) => {
        const view = this.getAtlasView();
        if (!view) return false;
        if (!checking) view.clearBoard();
        return true;
      },
    });

    this.addCommand({
      id: 'atlas-reload',
      name: '重新扫描论文库',
      callback: () => {
        void this.reloadViews();
      },
    });

    this.addSettingTab(new AtlasSettingTab(this.app, this));
  }

  async openAtlas(): Promise<void> {
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({
      type: ATLAS_VIEW_TYPE,
      active: true,
      state: { file: this.settings.boardPath },
    });
  }

  getAtlasView(): AtlasView | null {
    for (const leaf of this.app.workspace.getLeavesOfType(ATLAS_VIEW_TYPE)) {
      if (leaf.view instanceof AtlasView) return leaf.view;
    }
    return null;
  }

  async reloadViews(): Promise<void> {
    const views = this.app.workspace
      .getLeavesOfType(ATLAS_VIEW_TYPE)
      .map((leaf) => leaf.view)
      .filter((view): view is AtlasView => view instanceof AtlasView);
    if (!views.length) {
      new Notice('Paper Atlas：还没有打开的画布');
      return;
    }
    await Promise.all(views.map((view) => view.reloadAll()));
    new Notice(`Paper Atlas：已重新扫描 ${views.length} 个画布`);
  }

  async loadSettings(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

class AtlasSettingTab extends PluginSettingTab {
  private readonly plugin: PaperAtlasPlugin;

  constructor(app: App, plugin: PaperAtlasPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Paper Atlas 设置' });

    new Setting(containerEl)
      .setName('论文目录')
      .setDesc('扫描这个目录下的 Markdown 笔记（含子目录），有 title 或 authors 属性的才算论文。')
      .addText((text) =>
        text
          .setValue(this.plugin.settings.paperFolder)
          .setPlaceholder('30_References/Paper/manager')
          .onChange(async (value) => {
            this.plugin.settings.paperFolder =
              value.trim().replace(/^\/+|\/+$/g, '') || DEFAULT_SETTINGS.paperFolder;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('画布文件')
      .setDesc('自定义的 .pcanvas 文件，JSON 格式，会被坚果云 / git 正常同步。')
      .addText((text) =>
        text
          .setValue(this.plugin.settings.boardPath)
          .setPlaceholder('30_References/Paper/manager/论文图谱.pcanvas')
          .onChange(async (value) => {
            this.plugin.settings.boardPath = value.trim() || DEFAULT_SETTINGS.boardPath;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('卡片宽度')
      .setDesc('新拖入画布的卡片默认宽度，已有卡片不受影响。')
      .addSlider((slider) =>
        slider
          .setLimits(260, 560, 10)
          .setValue(this.plugin.settings.cardWidth)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.cardWidth = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('默认展开论文仓')
      .setDesc('打开画布时右侧论文仓是否展开。')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.sidebarOpen).onChange(async (value) => {
          this.plugin.settings.sidebarOpen = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('继承论文管理器配色')
      .setDesc('读取 obsidian-mypaper-plugin 的 data.json，复用同一套领域颜色（只读，不会改动它）。')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.inheritPalette).onChange(async (value) => {
          this.plugin.settings.inheritPalette = value;
          await this.plugin.saveSettings();
          const view = this.plugin.getAtlasView();
          if (view) await view.reloadAll();
        }),
      );

    new Setting(containerEl)
      .setName('刷新')
      .setDesc('改完目录或画布路径后，点这里让已打开的画布重新读取。')
      .addButton((button) =>
        button.setButtonText('重新扫描').setCta().onClick(async () => {
          await this.plugin.reloadViews();
        }),
      );

    containerEl.createEl('p', {
      cls: 'pa-settings-hint',
      text: '快捷键：空格 / 中键拖拽平移，Ctrl+滚轮缩放，Shift+1 适应视图（需先点一下画布）。右键卡片或连线可以编辑、删除。',
    });
  }
}
