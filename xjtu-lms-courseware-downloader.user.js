// ==UserScript==
// @name         西安交大LMS课件下载器
// @namespace    https://github.com/WindustH/xjtu-lms-courseware-downloader
// @version      4.0.1
// @description  自动下载西安交通大学LMS系统的课件文件，支持所有课件（包括无下载权限的）
// @author       WindustH
// @match        https://lms.xjtu.edu.cn/course/*/courseware*
// @run-at       document-end
// @license MIT
// ==/UserScript==

(function() {
    'use strict';

    // ============================================
    // 常量配置
    // ============================================

    const CONFIG = {
        VERSION: '4.2.0',
        SCRIPT_NAME: 'LMS下载器',
        // 选择器
        SELECTORS: {
            COURSEWARE_ITEM: '.learning-activity.list-item',
            EXPAND_BTN: '.expand-collapse-attachments',
            ATTACHMENT_ROW: '.attachment-row',
            ACTIVITY_TITLE: '.activity-title a.title',
            MODULE: '.shorten-module span.ng-binding',
            SIZE: '.attachment-size span.ng-binding',
            FILE_NAME: '.file-name',
            FILE_EXT: '.file-extension'
        },
        // 超时配置
        TIMEOUTS: {
            WAIT_ELEMENT: 15000,
            EXPAND_DELAY: 500,
            REQUEST_TIMEOUT: 10000,
            NOTIFICATION_DURATION: 3000,
            DOWNLOAD_INTERVAL: 1500
        },
        // UI配置
        UI: {
            PANEL_WIDTH: 420,
            PANEL_MAX_HEIGHT: '80vh',
            Z_INDEX: 10000,
            COLORS: {
                PRIMARY: '#1e88e5',
                PRIMARY_DARK: '#1565c0',
                SUCCESS: '#4caf50',
                ERROR: '#f44336',
                WARNING: '#ff9800',
                GRAY: '#e0e0e0',
                LIGHT_GRAY: '#f5f5f5'
            }
        }
    };

    // ============================================
    // 日志系统
    // ============================================

    const Logger = {
        PREFIX: `[${CONFIG.SCRIPT_NAME}]`,

        info(...args) {
            console.log(this.PREFIX, ...args);
        },

        error(...args) {
            console.error(this.PREFIX, ...args);
        },

        warn(...args) {
            console.warn(this.PREFIX, ...args);
        }
    };

    // ============================================
    // 工具类
    // ============================================

    const Utils = {
        /**
         * 从URL中提取课程号
         */
        getCourseId() {
            const match = window.location.pathname.match(/\/course\/(\d+)\//);
            return match ? match[1] : null;
        },

        /**
         * 安全获取元素文本
         */
        safeGetText(element, selector, defaultValue = '') {
            try {
                const el = element?.querySelector(selector);
                return el?.textContent?.trim() || defaultValue;
            } catch (e) {
                Logger.warn('获取文本失败:', selector, e);
                return defaultValue;
            }
        },

        /**
         * 延迟函数
         */
        delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        },

        /**
         * 等待元素出现
         */
        waitForElement(selector, timeout = CONFIG.TIMEOUTS.WAIT_ELEMENT) {
            return new Promise((resolve, reject) => {
                const element = document.querySelector(selector);
                if (element) {
                    resolve(element);
                    return;
                }

                const observer = new MutationObserver(() => {
                    const element = document.querySelector(selector);
                    if (element) {
                        observer.disconnect();
                        resolve(element);
                    }
                });

                observer.observe(document.body, {
                    childList: true,
                    subtree: true
                });

                setTimeout(() => {
                    observer.disconnect();
                    reject(new Error(`元素未找到: ${selector}`));
                }, timeout);
            });
        },

        /**
         * 清理文件名中的非法字符
         */
        sanitizeFilename(filename) {
            return filename
                .replace(/[<>:"/\\|?*]/g, '_')
                .replace(/\s+/g, '_')
                .substring(0, 200);
        }
    };

    // ============================================
    // 课件信息提取器
    // ============================================

    const CoursewareExtractor = {
        /**
         * 展开课件附件
         */
        async expandAttachments(container) {
            try {
                const expandBtn = container.querySelector(CONFIG.SELECTORS.EXPAND_BTN);
                if (!expandBtn) return false;

                const isExpanded = expandBtn.textContent.includes('收起');
                if (!isExpanded) {
                    expandBtn.click();
                    await Utils.delay(CONFIG.TIMEOUTS.EXPAND_DELAY);
                    return true;
                }
                return false;
            } catch (e) {
                Logger.error('展开附件失败:', e);
                return false;
            }
        },

        /**
         * 获取课件基本信息
         */
        getCoursewareInfo(container) {
            return {
                name: Utils.safeGetText(container, CONFIG.SELECTORS.ACTIVITY_TITLE, '未命名课件'),
                module: Utils.safeGetText(container, CONFIG.SELECTORS.MODULE),
                size: Utils.safeGetText(container, CONFIG.SELECTORS.SIZE)
            };
        },

        /**
         * 获取所有附件行
         */
        getAllAttachmentRows(container) {
            return container.querySelectorAll(CONFIG.SELECTORS.ATTACHMENT_ROW);
        },

        /**
         * 获取文件名（从附件行中提取）
         */
        getFileName(attachmentRow) {
            const fileName = Utils.safeGetText(attachmentRow, CONFIG.SELECTORS.FILE_NAME);
            const fileExt = Utils.safeGetText(attachmentRow, CONFIG.SELECTORS.FILE_EXT);
            return fileName + fileExt;
        },

        /**
         * 获取附件大小
         */
        getFileSize(attachmentRow) {
            return Utils.safeGetText(attachmentRow, CONFIG.SELECTORS.SIZE);
        },

        /**
         * 从 Angular scope 获取 upload 信息
         */
        getUploadInfo(attachmentRow) {
            try {
                if (!attachmentRow) return null;

                // 检查 Angular 是否可用
                if (typeof angular === 'undefined') {
                    Logger.warn('Angular 未加载');
                    return null;
                }

                const scope = angular.element(attachmentRow).scope();
                return scope?.upload || null;
            } catch (e) {
                Logger.error('获取 upload info 失败:', e);
                return null;
            }
        }
    };

    // ============================================
    // 下载链接获取器
    // ============================================

    const DownloadUrlFetcher = {
        /**
         * 获取下载URL（直接使用API URL，避免重定向URL的时效性问题）
         * 使用 reference_id 而不是 id，与页面中的下载链接保持一致
         */
        getDownloadUrl(uploadInfo) {
            if (!uploadInfo) {
                return Promise.reject(new Error('uploadInfo 为空'));
            }

            // 优先使用 reference_id，与页面中的下载链接一致
            const id = uploadInfo.reference_id || uploadInfo.id;
            const url = `/api/uploads/reference/${id}/blob`;
            Logger.info('获取下载链接:', uploadInfo.name, '->', url);
            return Promise.resolve(url);
        },

        /**
         * 获取课件的所有附件下载信息
         */
        async fetchAllCoursewareAttachments(container) {
            const coursewareInfo = CoursewareExtractor.getCoursewareInfo(container);
            const attachmentRows = CoursewareExtractor.getAllAttachmentRows(container);

            if (attachmentRows.length === 0) {
                return [{
                    ...coursewareInfo,
                    fileName: '',
                    downloadUrl: null,
                    hasDownload: false,
                    error: '未找到附件'
                }];
            }

            const attachments = [];

            for (let i = 0; i < attachmentRows.length; i++) {
                const attachmentRow = attachmentRows[i];
                const fileName = CoursewareExtractor.getFileName(attachmentRow);
                const fileSize = CoursewareExtractor.getFileSize(attachmentRow);
                const uploadInfo = CoursewareExtractor.getUploadInfo(attachmentRow);

                if (!uploadInfo || !uploadInfo.id) {
                    attachments.push({
                        ...coursewareInfo,
                        fileName,
                        size: fileSize,
                        downloadUrl: null,
                        hasDownload: false,
                        error: '未找到文件信息'
                    });
                    continue;
                }

                try {
                    const downloadUrl = await this.getDownloadUrl(uploadInfo);
                    attachments.push({
                        ...coursewareInfo,
                        fileName: uploadInfo.name || fileName,
                        size: fileSize,
                        downloadUrl,
                        hasDownload: true,
                        allowDownload: uploadInfo.allow_download || false
                    });
                } catch (e) {
                    Logger.error('获取下载链接失败:', uploadInfo.id, e.message);
                    attachments.push({
                        ...coursewareInfo,
                        fileName,
                        size: fileSize,
                        downloadUrl: null,
                        hasDownload: false,
                        error: e.message
                    });
                }
            }

            return attachments;
        }
    };

    // ============================================
    // UI 组件
    // ============================================

    const UI = {
        /**
         * 创建通知
         */
        showNotification(message, type = 'info') {
            const notification = document.createElement('div');
            const bgColor = type === 'error' ? CONFIG.UI.COLORS.ERROR : CONFIG.UI.COLORS.SUCCESS;

            notification.style.cssText = `
                position: fixed;
                top: 80px;
                right: 20px;
                background: ${bgColor};
                color: white;
                padding: 15px 20px;
                border-radius: 6px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                z-index: ${CONFIG.UI.Z_INDEX + 1};
                font-size: 14px;
                font-family: Arial, sans-serif;
            `;
            notification.textContent = message;
            document.body.appendChild(notification);

            setTimeout(() => {
                notification.remove();
            }, CONFIG.TIMEOUTS.NOTIFICATION_DURATION);
        },

        /**
         * 创建主按钮
         */
        createMainButton(onClick) {
            const button = document.createElement('button');
            button.id = 'xjtu-fetch-courses-btn';
            button.innerHTML = '📥 获取课件下载链接';
            button.style.cssText = `
                position: fixed;
                bottom: 30px;
                right: 30px;
                background: linear-gradient(135deg, #ff6b6b 0%, #ee5a6f 100%);
                color: white;
                border: none;
                padding: 15px 25px;
                border-radius: 30px;
                font-size: 16px;
                font-weight: bold;
                cursor: pointer;
                box-shadow: 0 4px 15px rgba(238, 90, 111, 0.4);
                z-index: ${CONFIG.UI.Z_INDEX - 1};
                transition: all 0.3s ease;
            `;

            button.onmouseover = () => button.style.transform = 'translateY(-2px)';
            button.onmouseout = () => button.style.transform = 'translateY(0)';
            button.onclick = onClick;

            return button;
        },

        /**
         * 更新按钮状态
         */
        updateButtonState(button, text, disabled = false) {
            if (button) {
                button.disabled = disabled;
                button.innerHTML = text;
            }
        },

        /**
         * 创建下载面板
         */
        createDownloadPanel(coursewareGroups, onDownload, onDownloadAll, onCopy) {
            // 移除旧面板
            const oldPanel = document.getElementById('xjtu-download-panel');
            if (oldPanel) oldPanel.remove();

            const panel = document.createElement('div');
            panel.id = 'xjtu-download-panel';
            panel.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                width: ${CONFIG.UI.PANEL_WIDTH}px;
                max-height: ${CONFIG.UI.PANEL_MAX_HEIGHT};
                background: white;
                border: 2px solid ${CONFIG.UI.COLORS.PRIMARY};
                border-radius: 8px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                z-index: ${CONFIG.UI.Z_INDEX};
                font-family: Arial, sans-serif;
                overflow: hidden;
            `;

            const courseId = Utils.getCourseId();
            const downloadableCount = coursewareGroups.reduce((sum, group) =>
                sum + group.attachments.filter(a => a.hasDownload).length, 0);
            const noPermissionCount = coursewareGroups.reduce((sum, group) =>
                sum + group.attachments.filter(a => a.hasDownload && !a.allowDownload).length, 0);

            panel.innerHTML = this.generatePanelHTML(coursewareGroups, courseId, downloadableCount, noPermissionCount);
            document.body.appendChild(panel);

            this.bindPanelEvents(panel, coursewareGroups, onDownload, onDownloadAll, onCopy, downloadableCount);
        },

        /**
         * 生成面板HTML（层级结构）
         */
        generatePanelHTML(coursewareGroups, courseId, downloadableCount, noPermissionCount) {
            // 计算总文件数
            const totalFiles = coursewareGroups.reduce((sum, group) => sum + group.attachments.length, 0);

            const itemsHTML = coursewareGroups.map((group, groupIndex) => {
                const attachmentsHTML = group.attachments.map((attachment, attachmentIndex) => {
                    const dataIndex = `${groupIndex}-${attachmentIndex}`;
                    return `
                        <div class="attachment-item" style="padding: 8px; margin-top: 8px;
                                border: 1px solid ${CONFIG.UI.COLORS.GRAY}; border-radius: 4px;
                                background: white; ${attachment.hasDownload ? '' : 'opacity: 0.6;'}">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div style="flex: 1; min-width: 0;">
                                    <div style="display: flex; align-items: center; gap: 5px; margin-bottom: 2px;">
                                        <span style="font-size: 13px; color: #333;">
                                            ${this.escapeHtml(attachment.fileName || attachment.name)}
                                        </span>
                                        ${attachment.hasDownload && !attachment.allowDownload ? `
                                            <span style="background: ${CONFIG.UI.COLORS.WARNING}; color: white;
                                                   font-size: 9px; padding: 1px 4px; border-radius: 2px;">私有版权保护</span>
                                        ` : ''}
                                    </div>
                                    <div style="font-size: 11px; color: #999;">
                                        ${attachment.size ? `📦 ${this.escapeHtml(attachment.size)}` : ''}
                                    </div>
                                    ${attachment.error ? `<div style="font-size: 10px; color: ${CONFIG.UI.COLORS.ERROR};">❌ ${this.escapeHtml(attachment.error)}</div>` : ''}
                                </div>
                                <div style="margin-left: 10px;">
                                    ${attachment.hasDownload
                                        ? `<button class="download-single" data-index="${dataIndex}"
                                                   style="background: ${CONFIG.UI.COLORS.SUCCESS}; color: white;
                                                          border: none; padding: 4px 8px; border-radius: 3px;
                                                          cursor: pointer; font-size: 11px;">
                                                    ⬇ 下载
                                           </button>`
                                        : `<span style="color: ${CONFIG.UI.COLORS.ERROR}; font-size: 11px;">❌</span>`
                                    }
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');

                const downloadableInGroup = group.attachments.filter(a => a.hasDownload).length;

                return `
                    <div class="courseware-group" style="padding: 10px; margin-bottom: 15px;
                            border: 1px solid ${CONFIG.UI.COLORS.PRIMARY}; border-radius: 8px;
                            background: #f8f9fa;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; padding-bottom: 8px;
                                border-bottom: 1px solid ${CONFIG.UI.COLORS.GRAY};">
                            <div style="background: ${CONFIG.UI.COLORS.PRIMARY}; color: white;
                                    width: 24px; height: 24px; border-radius: 50%;
                                    display: flex; align-items: center; justify-content: center;
                                    font-size: 12px; font-weight: bold;">
                                ${groupIndex + 1}
                            </div>
                            <div style="flex: 1;">
                                <div style="font-weight: bold; color: #333; font-size: 14px;">
                                    ${this.escapeHtml(group.name)}
                                </div>
                                <div style="font-size: 11px; color: #666;">
                                    ${group.module ? `📖 ${this.escapeHtml(group.module)}` : ''}
                                    <span style="margin-left: 8px;">📎 ${group.attachments.length} 个文件</span>
                                    <span style="margin-left: 8px;">⬇ 可下载 ${downloadableInGroup} 个</span>
                                </div>
                            </div>
                            <button class="download-group" data-group="${groupIndex}"
                                    style="background: ${CONFIG.UI.COLORS.SUCCESS}; color: white;
                                           border: none; padding: 5px 10px; border-radius: 4px;
                                           cursor: pointer; font-size: 12px; font-weight: bold;">
                                下载本组
                            </button>
                        </div>
                        ${attachmentsHTML}
                    </div>
                `;
            }).join('');

            return `
                <div style="background: linear-gradient(135deg, ${CONFIG.UI.COLORS.PRIMARY} 0%, ${CONFIG.UI.COLORS.PRIMARY_DARK} 100%);
                        color: white; padding: 15px; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="font-size: 18px; font-weight: bold;">📚 课件下载器 v${CONFIG.VERSION}</div>
                        <div style="font-size: 12px; opacity: 0.9;">课程: ${courseId} | ${coursewareGroups.length} 个课件项 | ${totalFiles} 个文件</div>
                    </div>
                    <button id="close-panel" style="background: rgba(255,255,255,0.2); border: none;
                            color: white; font-size: 20px; cursor: pointer;
                            padding: 5px 10px; border-radius: 4px;">✕</button>
                </div>
                <div style="padding: 15px; max-height: 50vh; overflow-y: auto;">
                    ${itemsHTML}
                </div>
                <div style="padding: 15px; border-top: 1px solid ${CONFIG.UI.COLORS.GRAY};
                        background: ${CONFIG.UI.COLORS.LIGHT_GRAY};">
                    <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                        <button id="download-all" style="flex: 1; background: ${CONFIG.UI.COLORS.SUCCESS}; color: white;
                                border: none; padding: 12px; border-radius: 6px; cursor: pointer;
                                font-size: 14px; font-weight: bold;">
                            ⬇ 下载全部 (${downloadableCount})
                        </button>
                        <button id="copy-all" style="flex: 1; background: ${CONFIG.UI.COLORS.PRIMARY}; color: white;
                                border: none; padding: 12px; border-radius: 6px; cursor: pointer;
                                font-size: 14px; font-weight: bold;">
                            📋 复制链接
                        </button>
                    </div>
                    ${noPermissionCount > 0 ? `
                        <div style="font-size: 11px; color: ${CONFIG.UI.COLORS.WARNING}; text-align: center;">
                            ⚠️ ${noPermissionCount} 个课件通过技术手段获取，请合理使用
                        </div>
                    ` : ''}
                </div>
            `;
        },

        /**
         * 绑定面板事件
         */
        bindPanelEvents(panel, coursewareGroups, onDownload, onDownloadAll, onCopy, downloadableCount) {
            // 关闭按钮
            panel.querySelector('#close-panel').addEventListener('click', () => panel.remove());

            // 单个文件下载
            panel.querySelectorAll('.download-single').forEach(btn => {
                btn.addEventListener('click', () => {
                    const [groupIndex, attachmentIndex] = btn.dataset.index.split('-').map(Number);
                    const attachment = coursewareGroups[groupIndex]?.attachments[attachmentIndex];
                    if (attachment?.downloadUrl) {
                        onDownload(attachment.downloadUrl, attachment.fileName || attachment.name);
                    }
                });
            });

            // 整组下载
            panel.querySelectorAll('.download-group').forEach(btn => {
                btn.addEventListener('click', () => {
                    const groupIndex = parseInt(btn.dataset.group);
                    const group = coursewareGroups[groupIndex];
                    if (group?.attachments) {
                        group.attachments.forEach((attachment, index) => {
                            if (attachment.hasDownload && attachment.downloadUrl) {
                                setTimeout(() => {
                                    onDownload(attachment.downloadUrl, attachment.fileName || attachment.name);
                                }, index * CONFIG.TIMEOUTS.DOWNLOAD_INTERVAL);
                            }
                        });
                    }
                });
            });

            // 下载全部
            panel.querySelector('#download-all').addEventListener('click', () => {
                onDownloadAll(coursewareGroups);
            });

            // 复制链接
            panel.querySelector('#copy-all').addEventListener('click', () => {
                onCopy(coursewareGroups);
            });
        },

        /**
         * HTML转义
         */
        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    };

    // ============================================
    // 下载管理器
    // ============================================

    const DownloadManager = {
        /**
         * 下载单个文件
         */
        downloadFile(url, filename) {
            try {
                const safeName = Utils.sanitizeFilename(filename);
                const a = document.createElement('a');
                a.href = url;
                a.download = safeName;
                a.target = '_blank';
                a.style.display = 'none';

                document.body.appendChild(a);
                a.click();

                // 延迟移除元素，确保下载触发
                setTimeout(() => {
                    document.body.removeChild(a);
                }, 100);

                UI.showNotification(`开始下载: ${safeName}`);
                Logger.info('下载文件:', safeName);
            } catch (err) {
                Logger.error('下载失败:', err);
                UI.showNotification(`下载失败: ${filename}`, 'error');
            }
        },

        /**
         * 下载全部文件
         */
        downloadAll(coursewareGroups) {
            const allAttachments = [];
            coursewareGroups.forEach(group => {
                group.attachments.forEach(attachment => {
                    if (attachment.hasDownload && attachment.downloadUrl) {
                        allAttachments.push(attachment);
                    }
                });
            });

            allAttachments.forEach((attachment, index) => {
                setTimeout(() => {
                    this.downloadFile(attachment.downloadUrl, attachment.fileName || attachment.name);
                }, index * CONFIG.TIMEOUTS.DOWNLOAD_INTERVAL);
            });

            UI.showNotification(`开始下载 ${allAttachments.length} 个文件`);
        },

        /**
         * 复制所有链接
         */
        copyAllLinks(coursewareGroups) {
            const links = [];
            coursewareGroups.forEach(group => {
                group.attachments.forEach(attachment => {
                    if (attachment.hasDownload && attachment.downloadUrl) {
                        links.push(`[${group.name}] ${attachment.fileName || attachment.name}: ${attachment.downloadUrl}`);
                    }
                });
            });

            const linkText = links.join('\n');

            navigator.clipboard.writeText(linkText)
                .then(() => UI.showNotification(`链接已复制到剪贴板 (${links.length} 个文件)`))
                .catch(() => UI.showNotification('复制失败', 'error'));
        }
    };

    // ============================================
    // 主控制器
    // ============================================

    const App = {
        isProcessing: false,
        mainButton: null,

        /**
         * 初始化
         */
        init() {
            // 检查是否在课件页面
            if (!window.location.pathname.includes('/courseware')) {
                return;
            }

            // 等待DOM加载完成
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => this.setupUI());
            } else {
                this.setupUI();
            }

            Logger.info(`v${CONFIG.VERSION} 已启动`);
        },

        /**
         * 设置UI
         */
        setupUI() {
            // 避免重复创建按钮
            if (document.getElementById('xjtu-fetch-courses-btn')) {
                return;
            }

            this.mainButton = UI.createMainButton(() => this.fetchCoursewareLinks());
            document.body.appendChild(this.mainButton);
        },

        /**
         * 获取所有课件链接
         */
        async fetchCoursewareLinks() {
            // 防止重复执行
            if (this.isProcessing) {
                UI.showNotification('正在处理中，请稍候...', 'error');
                return;
            }

            this.isProcessing = true;
            UI.updateButtonState(this.mainButton, '⏳ 正在获取课件...', true);

            try {
                // 等待课件列表加载
                await Utils.waitForElement(CONFIG.SELECTORS.COURSEWARE_ITEM);

                const containers = document.querySelectorAll(CONFIG.SELECTORS.COURSEWARE_ITEM);
                const coursewareGroups = [];

                // 逐个处理课件
                for (let i = 0; i < containers.length; i++) {
                    const container = containers[i];

                    // 更新进度
                    UI.updateButtonState(this.mainButton, `⏳ 正在获取课件... (${i + 1}/${containers.length})`, true);

                    // 展开附件
                    await CoursewareExtractor.expandAttachments(container);

                    // 获取课件基本信息
                    const coursewareInfo = CoursewareExtractor.getCoursewareInfo(container);

                    // 获取所有附件的下载信息
                    const attachments = await DownloadUrlFetcher.fetchAllCoursewareAttachments(container);

                    coursewareGroups.push({
                        ...coursewareInfo,
                        attachments: attachments
                    });
                }

                // 显示下载面板
                this.showDownloadPanel(coursewareGroups);

                // 统计文件总数和可下载数
                const totalFiles = coursewareGroups.reduce((sum, group) => sum + group.attachments.length, 0);
                const downloadableCount = coursewareGroups.reduce((sum, group) =>
                    sum + group.attachments.filter(a => a.hasDownload).length, 0);

                UI.showNotification(`成功获取 ${coursewareGroups.length} 个课件项，共 ${totalFiles} 个文件，可下载 ${downloadableCount} 个`);

            } catch (error) {
                Logger.error('获取课件失败:', error);
                UI.showNotification('获取课件失败: ' + error.message, 'error');
            } finally {
                this.isProcessing = false;
                UI.updateButtonState(this.mainButton, '📥 获取课件下载链接', false);
            }
        },

        /**
         * 显示下载面板
         */
        showDownloadPanel(coursewareList) {
            UI.createDownloadPanel(
                coursewareList,
                (url, name) => DownloadManager.downloadFile(url, name),
                (list) => DownloadManager.downloadAll(list),
                (list) => DownloadManager.copyAllLinks(list)
            );
        }
    };

    // ============================================
    // 启动应用
    // ============================================

    App.init();

})();
