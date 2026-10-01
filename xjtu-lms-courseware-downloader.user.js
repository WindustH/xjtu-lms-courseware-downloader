// ==UserScript==
// @name         西安交大LMS课件下载器
// @namespace    https://github.com/WindustH/xjtu-lms-courseware-downloader
// @version      6.1.0
// @description  自动下载西安交通大学LMS系统的课件文件，支持所有课件（包括无下载权限和时效性token的文件）
// @author       WindustH
// @match        https://lms.xjtu.edu.cn/course/*/courseware*
// @match        https://lms.xjtu.edu.cn/course/*/learning-activity*
// @run-at       document-end
// @license MIT
// ==/UserScript==

(function() {
    'use strict';

    // ============================================
    // 常量定义
    // ============================================

    const CONSTANTS = {
        VERSION: '6.1.0',
        SCRIPT_NAME: 'LMS下载器',

        // DOM 选择器
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

        // 超时配置 (ms)
        TIMEOUTS: {
            WAIT_ELEMENT: 15000,
            EXPAND_DELAY: 500,
            PREVIEW_LOAD_DELAY: 300,
            NOTIFICATION_DURATION: 3000,
            DOWNLOAD_INTERVAL: 1500,
            PAGE_READY: 30000,
            ANGULAR_DATA: 10000
        },

        // 轮询间隔 (ms)
        POLL_INTERVAL: {
            FAST: 100,
            NORMAL: 200,
            SLOW: 500
        },

        // 重试配置
        RETRY: {
            FETCH_URL: 2
        },

        // 文件名限制
        MAX_FILENAME_LENGTH: 200
    };

    // 颜色主题
    const Theme = {
        colors: {
            primary: '#1e88e5',
            primaryDark: '#1565c0',
            success: '#4caf50',
            error: '#f44336',
            warning: '#ff9800',
            gray: '#e0e0e0',
            lightGray: '#f5f5f5'
        },

        gradients: {
            button: 'linear-gradient(135deg, #ff6b6b 0%, #ee5a6f 100%)',
            header: 'linear-gradient(135deg, #1e88e5 0%, #1565c0 100%)'
        }
    };

    // ============================================
    // 核心工具模块
    // ============================================

    const Utils = {
        // 获取课程 ID
        getCourseId() {
            const match = window.location.pathname.match(/\/course\/(\d+)\//);
            return match ? match[1] : null;
        },

        // 是否为课件页
        isCoursewarePage() {
            return window.location.pathname.includes('/courseware');
        },

        // 是否为学习活动页
        isLearningActivityPage() {
            return window.location.pathname.includes('/learning-activity');
        },

        // 获取学习活动 ID (learning-activity#/1424648)
        getActivityId() {
            const match = window.location.hash.match(/^#\/(\d+)/);
            return match ? match[1] : null;
        },

        // 格式化文件大小
        formatSize(bytes) {
            if (typeof bytes !== 'number') return '';
            const units = ['B', 'KB', 'MB', 'GB'];
            let size = bytes;
            let i = 0;
            while (size >= 1024 && i < units.length - 1) {
                size /= 1024;
                i++;
            }
            return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
        },

        // 延迟
        delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        },

        // 等待元素
        waitForElement(selector, timeout = CONSTANTS.TIMEOUTS.WAIT_ELEMENT) {
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

                observer.observe(document.body, { childList: true, subtree: true });

                setTimeout(() => {
                    observer.disconnect();
                    reject(new Error(`元素未找到: ${selector}`));
                }, timeout);
            });
        },

        // 安全获取文本
        safeGetText(element, selector, defaultValue = '') {
            try {
                const el = element?.querySelector(selector);
                return el?.textContent?.trim() || defaultValue;
            } catch (e) {
                Logger.warn('获取文本失败:', selector, e);
                return defaultValue;
            }
        },

        // 清理文件名
        sanitizeFilename(filename) {
            return filename
                .replace(/[<>:"/\\|?*]/g, '_')
                .replace(/\s+/g, '_')
                .substring(0, CONSTANTS.MAX_FILENAME_LENGTH);
        },

        // 转义 HTML
        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    };

    // 日志模块
    const Logger = {
        PREFIX: `[${CONSTANTS.SCRIPT_NAME}]`,

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
    // DOM 操作模块
    // ============================================

    const DOMHelper = {
        find(selector, parent = document) {
            return parent.querySelector(selector);
        },

        findAll(selector, parent = document) {
            return parent.querySelectorAll(selector);
        },

        create(tag, options = {}) {
            const element = document.createElement(tag);

            if (options.style) {
                element.style.cssText = options.style;
            }
            if (options.textContent) {
                element.textContent = options.textContent;
            }
            if (options.innerHTML) {
                element.innerHTML = options.innerHTML;
            }
            if (options.id) {
                element.id = options.id;
            }
            if (options.className) {
                element.className = options.className;
            }

            Object.entries(options.attributes || {}).forEach(([key, value]) => {
                element.setAttribute(key, value);
            });

            return element;
        },

        on(element, event, handler) {
            element.addEventListener(event, handler);
        }
    };

    // ============================================
    // 数据访问层
    // ============================================

    const DataProvider = {
        // 检查 Angular 是否就绪
        isAngularReady() {
            return typeof angular !== 'undefined';
        },

        // 获取上传信息
        getUploadInfo(attachmentRow) {
            try {
                if (!attachmentRow || !this.isAngularReady()) {
                    return null;
                }
                const scope = angular.element(attachmentRow).scope();
                return scope?.upload || null;
            } catch (e) {
                Logger.error('获取上传信息失败:', e);
                return null;
            }
        },

        // 等待 Angular 数据加载
        async waitForAngularData(container, getAttachmentRows) {
            const startTime = Date.now();

            while (Date.now() - startTime < CONSTANTS.TIMEOUTS.ANGULAR_DATA) {
                if (!this.isAngularReady()) {
                    await Utils.delay(CONSTANTS.POLL_INTERVAL.NORMAL);
                    continue;
                }

                const rows = getAttachmentRows(container);
                if (rows.length === 0) {
                    await Utils.delay(CONSTANTS.POLL_INTERVAL.NORMAL);
                    continue;
                }

                const firstUpload = this.getUploadInfo(rows[0]);
                if (firstUpload) {
                    return true;
                }

                await Utils.delay(CONSTANTS.POLL_INTERVAL.NORMAL);
            }

            throw new Error('Angular 数据加载超时');
        },

        // 请求 JSON 接口
        async fetchJson(url) {
            const response = await fetch(url, { credentials: 'same-origin' });
            if (!response.ok) {
                throw new Error(`请求失败 (${response.status}): ${url}`);
            }
            return response.json();
        },

        // 获取学习活动详情（含附件列表）
        fetchActivity(activityId) {
            return this.fetchJson(`/api/activities/${activityId}`);
        },

        // 获取原始文件的限时下载链接（无下载权限的文件也可用）
        async fetchUploadUrl(uploadId) {
            const data = await this.fetchJson(`/api/uploads/${uploadId}/url`);
            return data?.url || null;
        }
    };

    // ============================================
    // 业务逻辑层
    // ============================================

    const CoursewareService = {
        // 展开课件项
        async expandItem(container) {
            const btn = DOMHelper.find(CONSTANTS.SELECTORS.EXPAND_BTN, container);
            if (!btn) return false;

            const isExpanded = btn.textContent.includes('收起');
            if (!isExpanded) {
                btn.click();
                await Utils.delay(CONSTANTS.TIMEOUTS.EXPAND_DELAY);
                return true;
            }
            return false;
        },

        // 获取课件信息
        getItemInfo(container) {
            return {
                name: Utils.safeGetText(container, CONSTANTS.SELECTORS.ACTIVITY_TITLE, '未命名课件'),
                module: Utils.safeGetText(container, CONSTANTS.SELECTORS.MODULE),
                size: Utils.safeGetText(container, CONSTANTS.SELECTORS.SIZE)
            };
        },

        // 获取附件行
        getAttachmentRows(container) {
            return DOMHelper.findAll(CONSTANTS.SELECTORS.ATTACHMENT_ROW, container);
        },

        // 获取附件信息
        getAttachmentInfo(attachmentRow) {
            return {
                fileName: Utils.safeGetText(attachmentRow, CONSTANTS.SELECTORS.FILE_NAME) +
                          Utils.safeGetText(attachmentRow, CONSTANTS.SELECTORS.FILE_EXT),
                fileSize: Utils.safeGetText(attachmentRow, CONSTANTS.SELECTORS.SIZE),
                uploadInfo: DataProvider.getUploadInfo(attachmentRow)
            };
        },

        // 收集附件
        async collectAttachments(container) {
            const itemInfo = this.getItemInfo(container);
            const rows = Array.from(this.getAttachmentRows(container));

            if (rows.length === 0) {
                return [{
                    ...itemInfo,
                    fileName: '',
                    downloadUrl: null,
                    hasDownload: false,
                    error: '未找到附件'
                }];
            }

            return await Promise.all(rows.map(async (row) => {
                const info = this.getAttachmentInfo(row);
                return this.createAttachment(itemInfo, info);
            }));
        },

        // 创建附件对象
        createAttachment(itemInfo, attachmentInfo) {
            const uploadInfo = attachmentInfo.uploadInfo;
            const isNoDownload = uploadInfo?.allow_download === false;

            const attachment = {
                ...itemInfo,
                fileName: uploadInfo?.name || attachmentInfo.fileName,
                size: attachmentInfo.fileSize,
                downloadUrl: null,
                hasDownload: !!uploadInfo,
                allowDownload: uploadInfo?.allow_download || false,
                uploadId: uploadInfo?.id,
                needsFreshUrl: isNoDownload,
                error: !uploadInfo ? '未找到文件信息' : null
            };

            // 如果有上传信息且不需要获取 URL，则设置下载链接
            if (uploadInfo && !isNoDownload) {
                try {
                    attachment.downloadUrl = this.getDownloadUrl(uploadInfo);
                } catch (e) {
                    attachment.error = e.message;
                    attachment.hasDownload = false;
                }
            }

            return attachment;
        },

        // 获取下载链接
        getDownloadUrl(uploadInfo) {
            if (!uploadInfo) {
                throw new Error('上传信息为空');
            }

            // 尝试从 documentUrl 解析
            if (uploadInfo.allow_download === false && uploadInfo.documentUrl) {
                const match = uploadInfo.documentUrl.match(/[?&]file=([^&]+)/);
                if (match) {
                    return decodeURIComponent(match[1]);
                }
            }

            // 使用 API 链接
            const id = uploadInfo.reference_id || uploadInfo.id;
            return `/api/uploads/reference/${id}/blob`;
        },

        // 获取学习活动的附件（学习活动页）
        async collectActivity(activityId) {
            const activity = await DataProvider.fetchActivity(activityId);
            const itemInfo = {
                name: activity.title || '未命名课件',
                module: '',
                size: ''
            };

            const uploads = (activity.uploads || []).filter(upload => !upload.deleted);
            if (uploads.length === 0) {
                return {
                    ...itemInfo,
                    attachments: [{
                        ...itemInfo,
                        fileName: '',
                        downloadUrl: null,
                        hasDownload: false,
                        error: '未找到附件'
                    }]
                };
            }

            const attachments = uploads.map(upload => this.createAttachment(itemInfo, {
                fileName: upload.name,
                fileSize: Utils.formatSize(upload.size),
                uploadInfo: upload
            }));
            return { ...itemInfo, attachments };
        },

        // 获取新的下载链接
        async fetchFreshDownloadUrl(uploadId) {
            for (let attempt = 0; attempt <= CONSTANTS.RETRY.FETCH_URL; attempt++) {
                if (attempt > 0) {
                    Logger.info(`重试获取下载链接 (${attempt}/${CONSTANTS.RETRY.FETCH_URL})`);
                    await Utils.delay(500);
                }

                try {
                    const url = await DataProvider.fetchUploadUrl(uploadId);
                    if (url) {
                        return url;
                    }
                } catch (e) {
                    Logger.warn('获取下载链接出错:', e.message);
                }
            }

            Logger.error('获取下载链接失败');
            return null;
        }
    };

    // ============================================
    // UI 层
    // ============================================

    const UIManager = {
        // 显示通知
        showNotification(message, type = 'info') {
            const colors = {
                error: Theme.colors.error,
                success: Theme.colors.success,
                info: Theme.colors.success
            };

            const notification = DOMHelper.create('div', {
                style: `
                    position: fixed;
                    top: 80px;
                    right: 20px;
                    background: ${colors[type] || colors.info};
                    color: white;
                    padding: 15px 20px;
                    border-radius: 6px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                    z-index: 10001;
                    font-size: 14px;
                    font-family: Arial, sans-serif;
                `,
                textContent: message
            });

            document.body.appendChild(notification);
            setTimeout(() => notification.remove(), CONSTANTS.TIMEOUTS.NOTIFICATION_DURATION);
        },

        // 创建主按钮
        createMainButton(onClick) {
            const button = DOMHelper.create('button', {
                id: 'xjtu-main-button',
                style: `
                    position: fixed;
                    bottom: 30px;
                    right: 30px;
                    background: ${Theme.gradients.button};
                    color: white;
                    border: none;
                    padding: 15px 25px;
                    border-radius: 30px;
                    font-size: 16px;
                    font-weight: bold;
                    cursor: pointer;
                    box-shadow: 0 4px 15px rgba(238, 90, 111, 0.4);
                    z-index: 9999;
                    transition: all 0.3s ease;
                `,
                textContent: '📥 获取课件下载链接'
            });

            button.onmouseover = () => button.style.transform = 'translateY(-2px)';
            button.onmouseout = () => button.style.transform = 'translateY(0)';
            DOMHelper.on(button, 'click', onClick);

            return button;
        },

        // 更新主按钮
        updateMainButton(button, text, disabled = false) {
            if (button) {
                button.disabled = disabled;
                button.textContent = text;
            }
        },

        // 创建下载面板
        createDownloadPanel(coursewareGroups, handlers) {
            this.removeDownloadPanel();

            const panel = DOMHelper.create('div', {
                id: 'xjtu-download-panel',
                style: `
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    width: 420px;
                    max-height: 80vh;
                    background: white;
                    border: 2px solid ${Theme.colors.primary};
                    border-radius: 8px;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                    z-index: 10000;
                    font-family: Arial, sans-serif;
                    overflow: hidden;
                `
            });

            panel.innerHTML = this.renderPanel(coursewareGroups);
            document.body.appendChild(panel);
            this.bindPanelEvents(panel, handlers);
        },

        // 移除下载面板
        removeDownloadPanel() {
            const existingPanel = DOMHelper.find('#xjtu-download-panel');
            if (existingPanel) {
                existingPanel.remove();
            }
        },

        // 渲染面板
        renderPanel(groups) {
            const stats = this.calculateStats(groups);

            return `
                ${this.renderPanelHeader(stats)}
                ${this.renderPanelBody(groups)}
                ${this.renderPanelFooter(stats)}
            `;
        },

        // 计算统计
        calculateStats(groups) {
            return {
                courseId: Utils.getCourseId(),
                totalItems: groups.length,
                totalFiles: groups.reduce((sum, g) => sum + g.attachments.length, 0),
                downloadableCount: groups.reduce((sum, g) => sum + g.attachments.filter(a => a.hasDownload).length, 0),
                noPermissionCount: groups.reduce((sum, g) => sum + g.attachments.filter(a => a.hasDownload && !a.allowDownload).length, 0)
            };
        },

        // 渲染面板头部
        renderPanelHeader(stats) {
            return `
                <div style="background: ${Theme.gradients.header};
                        color: white; padding: 15px; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="font-size: 18px; font-weight: bold;">📚 课件下载器 v${CONSTANTS.VERSION}</div>
                        <div style="font-size: 12px; opacity: 0.9;">
                            课程: ${stats.courseId} | ${stats.totalItems} 个课件项 | ${stats.totalFiles} 个文件
                        </div>
                    </div>
                    <button id="close-panel-btn" style="background: rgba(255,255,255,0.2); border: none;
                            color: white; font-size: 20px; cursor: pointer;
                            padding: 5px 10px; border-radius: 4px;">✕</button>
                </div>
            `;
        },

        // 渲染面板主体
        renderPanelBody(groups) {
            const itemsHTML = groups.map((group, gi) => this.renderGroup(group, gi)).join('');
            return `<div style="padding: 15px; max-height: 50vh; overflow-y: auto;">${itemsHTML}</div>`;
        },

        // 渲染组
        renderGroup(group, index) {
            const attachmentsHTML = group.attachments.map((att, ai) => this.renderAttachment(att, index, ai)).join('');
            const downloadableCount = group.attachments.filter(a => a.hasDownload).length;

            return `
                <div style="padding: 10px; margin-bottom: 15px;
                        border: 1px solid ${Theme.colors.primary}; border-radius: 8px; background: #f8f9fa;">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; padding-bottom: 8px;
                            border-bottom: 1px solid ${Theme.colors.gray};">
                        <div style="background: ${Theme.colors.primary}; color: white;
                                width: 24px; height: 24px; border-radius: 50%;
                                display: flex; align-items: center; justify-content: center;
                                font-size: 12px; font-weight: bold;">${index + 1}</div>
                        <div style="flex: 1;">
                            <div style="font-weight: bold; color: #333; font-size: 14px;">${Utils.escapeHtml(group.name)}</div>
                            <div style="font-size: 11px; color: #666;">
                                ${group.module ? `📖 ${Utils.escapeHtml(group.module)}` : ''}
                                <span style="margin-left: 8px;">📎 ${group.attachments.length} 个文件</span>
                                <span style="margin-left: 8px;">⬇ 可下载 ${downloadableCount} 个</span>
                            </div>
                        </div>
                        <button class="download-group-btn" data-group="${index}"
                                style="background: ${Theme.colors.success}; color: white; border: none;
                                       padding: 5px 10px; border-radius: 4px; cursor: pointer;
                                       font-size: 12px; font-weight: bold;">下载本组</button>
                    </div>
                    ${attachmentsHTML}
                </div>
            `;
        },

        // 渲染附件
        renderAttachment(attachment, groupIndex, attachIndex) {
            const dataIndex = `${groupIndex}-${attachIndex}`;
            return `
                <div style="padding: 8px; margin-top: 8px;
                        border: 1px solid ${Theme.colors.gray}; border-radius: 4px;
                        background: white; ${attachment.hasDownload ? '' : 'opacity: 0.6;'}">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="flex: 1; min-width: 0;">
                            <div style="display: flex; align-items: center; gap: 5px; margin-bottom: 2px;">
                                <span style="font-size: 13px; color: #333;">${Utils.escapeHtml(attachment.fileName || attachment.name)}</span>
                                ${attachment.hasDownload && !attachment.allowDownload ? `
                                    <span style="background: ${Theme.colors.warning}; color: white;
                                           font-size: 9px; padding: 1px 4px; border-radius: 2px;">私有版权保护</span>
                                ` : ''}
                            </div>
                            <div style="font-size: 11px; color: #999;">
                                ${attachment.size ? `📦 ${Utils.escapeHtml(attachment.size)}` : ''}
                            </div>
                            ${attachment.error ? `<div style="font-size: 10px; color: ${Theme.colors.error};">❌ ${Utils.escapeHtml(attachment.error)}</div>` : ''}
                        </div>
                        <div style="margin-left: 10px;">
                            ${attachment.hasDownload
                                ? `<button class="download-single-btn" data-index="${dataIndex}"
                                           style="background: ${Theme.colors.success}; color: white;
                                                  border: none; padding: 4px 8px; border-radius: 3px;
                                                  cursor: pointer; font-size: 11px;">⬇ 下载</button>`
                                : `<span style="color: ${Theme.colors.error}; font-size: 11px;">❌</span>`
                            }
                        </div>
                    </div>
                </div>
            `;
        },

        // 渲染面板底部
        renderPanelFooter(stats) {
            return `
                <div style="padding: 15px; border-top: 1px solid ${Theme.colors.gray}; background: ${Theme.colors.lightGray};">
                    <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                        <button id="download-all-btn" style="flex: 1; background: ${Theme.colors.success}; color: white;
                                border: none; padding: 12px; border-radius: 6px; cursor: pointer;
                                font-size: 14px; font-weight: bold;">⬇ 下载全部 (${stats.downloadableCount})</button>
                        <button id="copy-all-btn" style="flex: 1; background: ${Theme.colors.primary}; color: white;
                                border: none; padding: 12px; border-radius: 6px; cursor: pointer;
                                font-size: 14px; font-weight: bold;">📋 复制链接</button>
                    </div>
                    ${stats.noPermissionCount > 0 ? `
                        <div style="font-size: 11px; color: ${Theme.colors.warning}; text-align: center;">
                            ⚠️ ${stats.noPermissionCount} 个课件通过技术手段获取，请合理使用
                        </div>
                    ` : ''}
                </div>
            `;
        },

        // 绑定面板事件
        bindPanelEvents(panel, handlers) {
            // 关闭按钮
            const closeBtn = DOMHelper.find('#close-panel-btn', panel);
            if (closeBtn) {
                DOMHelper.on(closeBtn, 'click', () => this.removeDownloadPanel());
            }

            // 单个下载
            panel.querySelectorAll('.download-single-btn').forEach(btn => {
                DOMHelper.on(btn, 'click', async () => {
                    const [gi, ai] = btn.dataset.index.split('-').map(Number);
                    const attachment = handlers.getAttachment(gi, ai);
                    if (attachment?.hasDownload) {
                        await handlers.onDownload(attachment);
                    }
                });
            });

            // 组下载
            panel.querySelectorAll('.download-group-btn').forEach(btn => {
                DOMHelper.on(btn, 'click', async () => {
                    const gi = parseInt(btn.dataset.group);
                    const attachments = handlers.getGroupAttachments(gi);
                    for (let i = 0; i < attachments.length; i++) {
                        await handlers.onDownload(attachments[i]);
                        if (i < attachments.length - 1) {
                            await Utils.delay(CONSTANTS.TIMEOUTS.DOWNLOAD_INTERVAL);
                        }
                    }
                });
            });

            // 全部下载
            const downloadAllBtn = DOMHelper.find('#download-all-btn', panel);
            if (downloadAllBtn) {
                DOMHelper.on(downloadAllBtn, 'click', () => handlers.onDownloadAll());
            }

            // 复制链接
            const copyAllBtn = DOMHelper.find('#copy-all-btn', panel);
            if (copyAllBtn) {
                DOMHelper.on(copyAllBtn, 'click', () => handlers.onCopy());
            }
        }
    };

    // ============================================
    // 下载管理器
    // ============================================

    const DownloadManager = {
        // 下载单个文件
        async downloadFile(attachment) {
            try {
                const filename = attachment.fileName || attachment.name;
                const safeName = Utils.sanitizeFilename(filename);
                let url = attachment.downloadUrl || '';

                // 如果需要获取新链接
                if (attachment.needsFreshUrl && attachment.uploadId) {
                    UIManager.showNotification(`正在获取下载链接: ${safeName}...`);
                    url = await CoursewareService.fetchFreshDownloadUrl(attachment.uploadId);
                    if (!url) {
                        UIManager.showNotification(`获取下载链接失败: ${filename}`, 'error');
                        return;
                    }
                }

                // 创建下载链接
                // 不使用 target=_blank：跨域链接 (media.xjtu.edu.cn) 会打开新标签页，
                // 批量下载时失去用户手势而被弹窗拦截；服务器返回 Content-Disposition: attachment，当前页不会跳转
                const a = DOMHelper.create('a', {
                    attributes: {
                        href: url,
                        download: safeName
                    },
                    style: 'display: none'
                });

                document.body.appendChild(a);
                a.click();
                setTimeout(() => a.remove(), 100);

                UIManager.showNotification(`开始下载: ${safeName}`, 'success');
                Logger.info('下载文件:', safeName);
            } catch (err) {
                Logger.error('下载失败:', err);
                UIManager.showNotification(`下载失败: ${attachment.fileName || attachment.name}`, 'error');
            }
        },

        // 批量下载
        async downloadMultiple(attachments) {
            const downloadable = attachments.filter(a => a.hasDownload);
            UIManager.showNotification(`开始下载 ${downloadable.length} 个文件`, 'info');

            for (let i = 0; i < downloadable.length; i++) {
                await this.downloadFile(downloadable[i]);
                if (i < downloadable.length - 1) {
                    await Utils.delay(CONSTANTS.TIMEOUTS.DOWNLOAD_INTERVAL);
                }
            }
        },

        // 复制链接（无下载权限的文件实时获取限时链接）
        async copyLinks(coursewareGroups) {
            const entries = coursewareGroups.flatMap(group =>
                group.attachments
                    .filter(attachment => attachment.hasDownload)
                    .map(attachment => ({ group, attachment }))
            );

            const lines = await Promise.all(entries.map(async ({ group, attachment }) => {
                const url = attachment.needsFreshUrl && attachment.uploadId
                    ? await CoursewareService.fetchFreshDownloadUrl(attachment.uploadId)
                    : attachment.downloadUrl;
                return url ? `[${group.name}] ${attachment.fileName || attachment.name}: ${url}` : null;
            }));
            const links = lines.filter(Boolean);

            navigator.clipboard.writeText(links.join('\n'))
                .then(() => UIManager.showNotification(`链接已复制到剪贴板 (${links.length} 个文件)`, 'success'))
                .catch(() => UIManager.showNotification('复制失败', 'error'));
        }
    };

    // ============================================
    // 应用控制器
    // ============================================

    const App = {
        mainButton: null,
        isProcessing: false,
        coursewareData: null,

        // 初始化
        init() {
            // 学习活动页通过 API 获取附件，无需等待课件列表
            if (Utils.isLearningActivityPage()) {
                this.setup();
                Logger.info(`v${CONSTANTS.VERSION} 已启动 (学习活动页)`);
                return;
            }

            if (!Utils.isCoursewarePage()) {
                return;
            }

            this.waitForPageReady().then(() => {
                this.setup();
                Logger.info(`v${CONSTANTS.VERSION} 已启动，页面已就绪`);
            }).catch((error) => {
                Logger.error('等待页面就绪失败:', error);
                this.setup(); // 即使失败也显示按钮
            });
        },

        // 等待页面就绪
        async waitForPageReady() {
            const startTime = Date.now();

            while (Date.now() - startTime < CONSTANTS.TIMEOUTS.PAGE_READY) {
                // 检查 Angular
                if (!DataProvider.isAngularReady()) {
                    await Utils.delay(CONSTANTS.POLL_INTERVAL.SLOW);
                    continue;
                }

                // 检查课件项
                const containers = DOMHelper.findAll(CONSTANTS.SELECTORS.COURSEWARE_ITEM);
                if (containers.length === 0) {
                    await Utils.delay(CONSTANTS.POLL_INTERVAL.SLOW);
                    continue;
                }

                // 验证数据可用
                const firstContainer = containers[0];
                await CoursewareService.expandItem(firstContainer);
                await Utils.delay(300);

                const rows = CoursewareService.getAttachmentRows(firstContainer);
                if (rows.length > 0) {
                    const firstUpload = DataProvider.getUploadInfo(rows[0]);
                    if (firstUpload) {
                        Logger.info('页面已完全加载，数据可用');
                        return true;
                    }
                }

                await Utils.delay(CONSTANTS.POLL_INTERVAL.SLOW);
            }

            throw new Error('页面加载超时');
        },

        // 设置 UI
        setup() {
            if (DOMHelper.find('#xjtu-main-button')) {
                return;
            }
            this.mainButton = UIManager.createMainButton(() => this.fetch());
            document.body.appendChild(this.mainButton);
        },

        // 获取课件数据
        async fetch() {
            if (this.isProcessing) {
                UIManager.showNotification('正在处理中，请稍候...', 'error');
                return;
            }

            this.isProcessing = true;
            UIManager.updateMainButton(this.mainButton, '⏳ 正在获取课件...', true);

            try {
                if (Utils.isLearningActivityPage()) {
                    await this.fetchActivity();
                } else {
                    await this.fetchCourseware();
                }

                this.showPanel();
                this.showSuccessMessage();

            } catch (error) {
                Logger.error('获取课件失败:', error);
                UIManager.showNotification('获取课件失败: ' + error.message, 'error');
            } finally {
                this.isProcessing = false;
                UIManager.updateMainButton(this.mainButton, '📥 获取课件下载链接', false);
            }
        },

        // 获取当前学习活动的附件
        async fetchActivity() {
            const activityId = Utils.getActivityId();
            if (!activityId) {
                throw new Error('未找到当前学习活动');
            }
            this.coursewareData = [await CoursewareService.collectActivity(activityId)];
        },

        // 获取课件页所有课件项
        async fetchCourseware() {
            const containers = DOMHelper.findAll(CONSTANTS.SELECTORS.COURSEWARE_ITEM);
            this.coursewareData = [];

            for (let i = 0; i < containers.length; i++) {
                UIManager.updateMainButton(
                    this.mainButton,
                    `⏳ 正在获取课件... (${i + 1}/${containers.length})`,
                    true
                );

                await CoursewareService.expandItem(containers[i]);
                await DataProvider.waitForAngularData(
                    containers[i],
                    CoursewareService.getAttachmentRows.bind(CoursewareService)
                );

                const info = CoursewareService.getItemInfo(containers[i]);
                const attachments = await CoursewareService.collectAttachments(containers[i]);
                this.coursewareData.push({ ...info, attachments });
            }
        },

        // 显示面板
        showPanel() {
            UIManager.createDownloadPanel(this.coursewareData, {
                getAttachment: (gi, ai) => this.coursewareData[gi]?.attachments[ai],
                getGroupAttachments: (gi) => this.coursewareData[gi]?.attachments.filter(a => a.hasDownload) || [],
                onDownload: (att) => DownloadManager.downloadFile(att),
                onDownloadAll: () => {
                    const all = this.coursewareData.flatMap(g => g.attachments.filter(a => a.hasDownload));
                    return DownloadManager.downloadMultiple(all);
                },
                onCopy: () => DownloadManager.copyLinks(this.coursewareData)
            });
        },

        // 显示成功消息
        showSuccessMessage() {
            const totalFiles = this.coursewareData.reduce((sum, g) => sum + g.attachments.length, 0);
            const downloadableCount = this.coursewareData.reduce((sum, g) => sum + g.attachments.filter(a => a.hasDownload).length, 0);
            UIManager.showNotification(
                `成功获取 ${this.coursewareData.length} 个课件项，共 ${totalFiles} 个文件，可下载 ${downloadableCount} 个`,
                'success'
            );
        }
    };

    // ============================================
    // 启动应用
    // ============================================

    App.init();

})();
