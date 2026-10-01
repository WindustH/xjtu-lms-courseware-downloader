// ==UserScript==
// @name         西安交大LMS课件下载器
// @namespace    https://github.com/WindustH/xjtu-lms-courseware-downloader
// @version      6.2.0
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
        VERSION: '6.2.0',
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
        MAX_FILENAME_LENGTH: 200,

        // 同时显示的通知数量上限
        MAX_SNACKBARS: 3,

        // 主按钮文字
        MAIN_BUTTON_LABEL: '获取课件下载链接'
    };

    // Material Design 3 主题（配色由种子色 #1e88e5 经 Content 方案生成，跟随系统深色模式）
    // 所有组件样式都挂在脚本自身元素的 id 下，避免被页面全局样式 (Foundation) 覆盖
    const Theme = {
        STYLE_ID: 'xjtu-md-styles',

        css: `
            .xjtu-md {
                --md-primary: #005ea4;
                --md-on-primary: #ffffff;
                --md-primary-container: #0077ce;
                --md-on-primary-container: #fdfcff;
                --md-secondary-container: #b7d4fd;
                --md-on-secondary-container: #3f5b7f;
                --md-tertiary-container: #9f56bb;
                --md-on-tertiary-container: #fffbff;
                --md-error: #ba1a1a;
                --md-on-surface: #181c22;
                --md-on-surface-variant: #404752;
                --md-outline: #707783;
                --md-outline-variant: #c0c7d4;
                --md-inverse-surface: #2d3137;
                --md-inverse-on-surface: #eef0f9;
                --md-inverse-primary: #a2c9ff;
                --md-inverse-error: #ffb4ab;
                --xjtu-sheet-bg: #ebeef6;
                --xjtu-card-bg: #ffffff;

                --md-elevation-1: 0 1px 2px rgba(0, 0, 0, .3), 0 1px 3px 1px rgba(0, 0, 0, .15);
                --md-elevation-3: 0 1px 3px rgba(0, 0, 0, .3), 0 4px 8px 3px rgba(0, 0, 0, .15);
                --md-elevation-4: 0 2px 3px rgba(0, 0, 0, .3), 0 6px 10px 4px rgba(0, 0, 0, .15);
                --md-ease-standard: cubic-bezier(.2, 0, 0, 1);
                --md-ease-emphasized-decelerate: cubic-bezier(.05, .7, .1, 1);
                --md-font: Roboto, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;

                font-family: var(--md-font);
                font-size: 14px;
                line-height: 20px;
                letter-spacing: normal;
                text-align: left;
                color: var(--md-on-surface);
                -webkit-font-smoothing: antialiased;
            }

            @media (prefers-color-scheme: dark) {
                .xjtu-md {
                    --md-primary: #a2c9ff;
                    --md-on-primary: #00315b;
                    --md-primary-container: #3394f1;
                    --md-on-primary-container: #001f3c;
                    --md-secondary-container: #2b486b;
                    --md-on-secondary-container: #9bb7e0;
                    --md-tertiary-container: #be72da;
                    --md-on-tertiary-container: #36004b;
                    --md-error: #ffb4ab;
                    --md-on-surface: #e0e2ea;
                    --md-on-surface-variant: #c0c7d4;
                    --md-outline: #8a919e;
                    --md-outline-variant: #404752;
                    --md-inverse-surface: #e0e2ea;
                    --md-inverse-on-surface: #2d3137;
                    --md-inverse-primary: #0060a8;
                    --md-inverse-error: #ba1a1a;
                    --xjtu-sheet-bg: #181c22;
                    --xjtu-card-bg: #262a30;
                }
            }

            #xjtu-download-panel, #xjtu-download-panel *, #xjtu-snackbar-host * {
                box-sizing: border-box;
            }

            .xjtu-md .xjtu-icon {
                display: block;
                flex: none;
                fill: currentColor;
            }

            /* 按钮重置 + 状态层 */
            #xjtu-main-button, #xjtu-download-panel button {
                all: unset;
                box-sizing: border-box;
                position: relative;
                display: inline-flex;
                flex: none;
                align-items: center;
                justify-content: center;
                overflow: hidden;
                cursor: pointer;
                user-select: none;
                -webkit-tap-highlight-color: transparent;
            }
            #xjtu-main-button::before, #xjtu-download-panel button::before {
                content: "";
                position: absolute;
                inset: 0;
                border-radius: inherit;
                background: currentColor;
                opacity: 0;
                pointer-events: none;
                transition: opacity 150ms linear;
            }
            #xjtu-main-button:hover::before, #xjtu-download-panel button:hover::before {
                opacity: .08;
            }
            #xjtu-main-button:active::before, #xjtu-download-panel button:active::before,
            #xjtu-main-button:focus-visible::before, #xjtu-download-panel button:focus-visible::before {
                opacity: .1;
            }
            #xjtu-main-button:focus-visible, #xjtu-download-panel button:focus-visible {
                outline: 3px solid var(--md-primary);
                outline-offset: 2px;
            }
            #xjtu-download-panel button:disabled {
                cursor: default;
                color: color-mix(in srgb, var(--md-on-surface) 38%, transparent);
                background: color-mix(in srgb, var(--md-on-surface) 12%, transparent);
                box-shadow: none;
            }
            #xjtu-download-panel button:disabled::before {
                opacity: 0;
            }

            /* 扩展 FAB */
            #xjtu-main-button {
                position: fixed;
                right: 24px;
                bottom: 24px;
                z-index: 9999;
                height: 56px;
                gap: 12px;
                padding: 0 20px 0 16px;
                border-radius: 16px;
                background: var(--md-primary-container);
                color: var(--md-on-primary-container);
                box-shadow: var(--md-elevation-3);
                font: 500 14px/20px var(--md-font);
                letter-spacing: .1px;
                transition: box-shadow 200ms var(--md-ease-standard);
            }
            #xjtu-main-button:hover {
                box-shadow: var(--md-elevation-4);
            }
            #xjtu-main-button:disabled {
                cursor: progress;
            }
            #xjtu-main-button .xjtu-spinner {
                display: none;
                width: 20px;
                height: 20px;
                margin: 2px;
                border: 2.5px solid currentColor;
                border-right-color: transparent;
                border-radius: 50%;
                animation: xjtu-spin 800ms linear infinite;
            }
            #xjtu-main-button.xjtu-loading .xjtu-icon {
                display: none;
            }
            #xjtu-main-button.xjtu-loading .xjtu-spinner {
                display: block;
            }

            /* 面板 */
            #xjtu-download-panel {
                position: fixed;
                top: 16px;
                right: 16px;
                z-index: 10000;
                display: flex;
                flex-direction: column;
                width: min(420px, calc(100vw - 32px));
                max-height: calc(100vh - 32px);
                background: var(--xjtu-sheet-bg);
                border-radius: 28px;
                box-shadow: var(--md-elevation-3);
                overflow: hidden;
                transform-origin: top right;
                animation: xjtu-sheet-enter 400ms var(--md-ease-emphasized-decelerate);
            }
            #xjtu-download-panel .xjtu-sheet-header {
                display: flex;
                align-items: flex-start;
                gap: 8px;
                padding: 20px 12px 12px 24px;
            }
            #xjtu-download-panel .xjtu-sheet-headline {
                flex: 1;
                min-width: 0;
                padding-top: 4px;
            }
            #xjtu-download-panel .xjtu-sheet-title {
                font-size: 22px;
                line-height: 28px;
                font-weight: 400;
            }
            #xjtu-download-panel .xjtu-sheet-subtitle {
                margin-top: 4px;
                font-size: 12px;
                line-height: 16px;
                letter-spacing: .4px;
                color: var(--md-on-surface-variant);
            }
            #xjtu-download-panel .xjtu-sheet-body {
                flex: 1 1 auto;
                min-height: 0;
                display: flex;
                flex-direction: column;
                gap: 12px;
                padding: 4px 16px 16px;
                overflow-y: auto;
                overscroll-behavior: contain;
                scrollbar-width: thin;
                scrollbar-color: var(--md-outline-variant) transparent;
            }
            #xjtu-download-panel .xjtu-sheet-footer {
                flex: none;
                padding: 16px 24px 20px;
                border-top: 1px solid var(--md-outline-variant);
            }
            #xjtu-download-panel .xjtu-note {
                display: flex;
                align-items: flex-start;
                gap: 8px;
                margin-bottom: 12px;
                font-size: 12px;
                line-height: 16px;
                letter-spacing: .4px;
                color: var(--md-on-surface-variant);
            }
            #xjtu-download-panel .xjtu-actions {
                display: flex;
                flex-wrap: wrap;
                justify-content: flex-end;
                gap: 8px;
            }
            #xjtu-download-panel .xjtu-empty {
                padding: 32px 16px;
                text-align: center;
                color: var(--md-on-surface-variant);
            }

            /* 课件卡片 */
            #xjtu-download-panel .xjtu-card {
                flex: none;
                padding: 4px 0;
                background: var(--xjtu-card-bg);
                border-radius: 16px;
            }
            #xjtu-download-panel .xjtu-card-header {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px 12px 8px 16px;
            }
            #xjtu-download-panel .xjtu-avatar {
                flex: none;
                display: flex;
                align-items: center;
                justify-content: center;
                width: 40px;
                height: 40px;
                border-radius: 50%;
                background: var(--md-primary-container);
                color: var(--md-on-primary-container);
                font-size: 16px;
                font-weight: 500;
            }
            #xjtu-download-panel .xjtu-card-headline {
                flex: 1;
                min-width: 0;
            }
            #xjtu-download-panel .xjtu-card-title {
                font-size: 16px;
                line-height: 24px;
                font-weight: 500;
                letter-spacing: .15px;
                overflow-wrap: anywhere;
            }
            #xjtu-download-panel .xjtu-card-subtitle {
                font-size: 12px;
                line-height: 16px;
                letter-spacing: .4px;
                color: var(--md-on-surface-variant);
            }

            /* 附件列表项 */
            #xjtu-download-panel .xjtu-list-item {
                display: flex;
                align-items: center;
                gap: 16px;
                min-height: 64px;
                padding: 8px 12px 8px 16px;
            }
            #xjtu-download-panel .xjtu-file-badge {
                flex: none;
                display: flex;
                align-items: center;
                justify-content: center;
                width: 40px;
                height: 40px;
                border-radius: 12px;
                background: var(--md-secondary-container);
                color: var(--md-on-secondary-container);
                font-size: 11px;
                line-height: 16px;
                font-weight: 600;
                letter-spacing: .5px;
            }
            #xjtu-download-panel .xjtu-list-text {
                flex: 1;
                min-width: 0;
            }
            #xjtu-download-panel .xjtu-list-headline {
                font-size: 14px;
                line-height: 20px;
                font-weight: 500;
                letter-spacing: .1px;
                overflow-wrap: anywhere;
            }
            #xjtu-download-panel .xjtu-list-supporting {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 4px 8px;
                margin-top: 4px;
                font-size: 12px;
                line-height: 16px;
                letter-spacing: .4px;
                color: var(--md-on-surface-variant);
            }
            #xjtu-download-panel .xjtu-label {
                display: inline-flex;
                align-items: center;
                gap: 2px;
                height: 20px;
                padding: 0 6px 0 4px;
                border-radius: 6px;
                background: var(--md-tertiary-container);
                color: var(--md-on-tertiary-container);
                font-size: 11px;
                font-weight: 500;
                letter-spacing: .5px;
            }
            #xjtu-download-panel .xjtu-list-error {
                display: flex;
                align-items: center;
                gap: 4px;
                margin-top: 4px;
                font-size: 12px;
                line-height: 16px;
                color: var(--md-error);
            }
            #xjtu-download-panel .xjtu-list-item-disabled .xjtu-file-badge,
            #xjtu-download-panel .xjtu-list-item-disabled .xjtu-list-headline {
                opacity: .38;
            }

            /* 按钮 */
            #xjtu-download-panel .xjtu-btn {
                height: 40px;
                gap: 8px;
                padding: 0 24px 0 16px;
                border-radius: 20px;
                font-size: 14px;
                line-height: 20px;
                font-weight: 500;
                letter-spacing: .1px;
                white-space: nowrap;
                transition: box-shadow 200ms var(--md-ease-standard);
            }
            #xjtu-download-panel .xjtu-btn-small {
                height: 32px;
                gap: 4px;
                padding: 0 12px 0 8px;
                border-radius: 16px;
            }
            #xjtu-download-panel .xjtu-btn-filled {
                background: var(--md-primary);
                color: var(--md-on-primary);
            }
            #xjtu-download-panel .xjtu-btn-filled:hover {
                box-shadow: var(--md-elevation-1);
            }
            #xjtu-download-panel .xjtu-btn-tonal {
                background: var(--md-secondary-container);
                color: var(--md-on-secondary-container);
            }
            #xjtu-download-panel .xjtu-btn-outlined {
                border: 1px solid var(--md-outline);
                color: var(--md-primary);
            }
            #xjtu-download-panel .xjtu-icon-btn {
                width: 40px;
                height: 40px;
                border-radius: 50%;
                color: var(--md-on-surface-variant);
            }
            #xjtu-download-panel .xjtu-icon-btn-tonal {
                background: var(--md-secondary-container);
                color: var(--md-on-secondary-container);
            }

            /* Snackbar */
            #xjtu-snackbar-host {
                position: fixed;
                left: 50%;
                bottom: 24px;
                z-index: 10001;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 8px;
                width: max-content;
                max-width: calc(100vw - 32px);
                transform: translateX(-50%);
                pointer-events: none;
            }
            #xjtu-snackbar-host .xjtu-snackbar {
                display: flex;
                align-items: center;
                gap: 12px;
                min-height: 48px;
                max-width: 560px;
                padding: 14px 16px;
                border-radius: 4px;
                background: var(--md-inverse-surface);
                color: var(--md-inverse-on-surface);
                box-shadow: var(--md-elevation-3);
                letter-spacing: .25px;
                animation: xjtu-snackbar-enter 250ms var(--md-ease-emphasized-decelerate);
            }
            #xjtu-snackbar-host .xjtu-icon {
                color: var(--md-inverse-primary);
            }
            #xjtu-snackbar-host .xjtu-snackbar-error .xjtu-icon {
                color: var(--md-inverse-error);
            }
            #xjtu-snackbar-host .xjtu-snackbar-leaving {
                animation: xjtu-snackbar-leave 150ms ease-in forwards;
            }
            @media (max-width: 600px) {
                #xjtu-snackbar-host {
                    bottom: 96px;
                }
            }

            @keyframes xjtu-spin {
                to { transform: rotate(360deg); }
            }
            @keyframes xjtu-sheet-enter {
                from { opacity: 0; transform: translateY(-8px) scale(.96); }
            }
            @keyframes xjtu-snackbar-enter {
                from { opacity: 0; transform: translateY(8px) scale(.96); }
            }
            @keyframes xjtu-snackbar-leave {
                to { opacity: 0; transform: translateY(4px); }
            }
            @media (prefers-reduced-motion: reduce) {
                #xjtu-download-panel, #xjtu-snackbar-host .xjtu-snackbar {
                    animation: none;
                }
            }
        `
    };

    // Material Symbols 图标 (24×24)
    const Icons = {
        paths: {
            download: 'M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z',
            close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
            copy: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
            file: 'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
            lock: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z',
            check: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
            error: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z',
            info: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z'
        },

        render(name, size = 24) {
            return `<svg class="xjtu-icon" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="${this.paths[name]}"/></svg>`;
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
        // 注入样式
        injectStyles() {
            if (DOMHelper.find(`#${Theme.STYLE_ID}`)) {
                return;
            }
            const style = DOMHelper.create('style', {
                id: Theme.STYLE_ID,
                textContent: Theme.css
            });
            (document.head || document.documentElement).appendChild(style);
        },

        // 获取 Snackbar 容器
        getSnackbarHost() {
            let host = DOMHelper.find('#xjtu-snackbar-host');
            if (!host) {
                host = DOMHelper.create('div', { id: 'xjtu-snackbar-host', className: 'xjtu-md' });
                document.body.appendChild(host);
            }
            return host;
        },

        // 显示通知 (Snackbar)
        showNotification(message, type = 'info') {
            const icons = {
                error: 'error',
                success: 'check',
                info: 'info'
            };

            const host = this.getSnackbarHost();
            const snackbar = DOMHelper.create('div', {
                className: `xjtu-snackbar xjtu-snackbar-${type}`,
                attributes: { role: type === 'error' ? 'alert' : 'status' },
                innerHTML: `${Icons.render(icons[type] || icons.info, 20)}<span>${Utils.escapeHtml(message)}</span>`
            });

            host.appendChild(snackbar);
            while (host.children.length > CONSTANTS.MAX_SNACKBARS) {
                host.firstElementChild.remove();
            }

            setTimeout(() => {
                snackbar.classList.add('xjtu-snackbar-leaving');
                setTimeout(() => snackbar.remove(), 150);
            }, CONSTANTS.TIMEOUTS.NOTIFICATION_DURATION);
        },

        // 创建主按钮 (扩展 FAB)
        createMainButton(onClick) {
            const button = DOMHelper.create('button', {
                id: 'xjtu-main-button',
                className: 'xjtu-md',
                attributes: { type: 'button' },
                innerHTML: `${Icons.render('download')}<span class="xjtu-spinner"></span><span class="xjtu-fab-label">${CONSTANTS.MAIN_BUTTON_LABEL}</span>`
            });

            DOMHelper.on(button, 'click', onClick);

            return button;
        },

        // 更新主按钮
        updateMainButton(button, text, disabled = false) {
            if (button) {
                button.disabled = disabled;
                button.classList.toggle('xjtu-loading', disabled);
                button.querySelector('.xjtu-fab-label').textContent = text;
            }
        },

        // 创建下载面板
        createDownloadPanel(coursewareGroups, handlers) {
            this.removeDownloadPanel();

            const panel = DOMHelper.create('div', {
                id: 'xjtu-download-panel',
                className: 'xjtu-md',
                attributes: { role: 'dialog', 'aria-label': '课件下载器' },
                innerHTML: this.renderPanel(coursewareGroups)
            });

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
            const meta = [
                `v${CONSTANTS.VERSION}`,
                `课程 ${stats.courseId}`,
                `${stats.totalItems} 个课件项`,
                `${stats.totalFiles} 个文件`
            ].join(' · ');

            return `
                <div class="xjtu-sheet-header">
                    <div class="xjtu-sheet-headline">
                        <div class="xjtu-sheet-title">课件下载器</div>
                        <div class="xjtu-sheet-subtitle">${meta}</div>
                    </div>
                    <button type="button" id="close-panel-btn" class="xjtu-icon-btn" title="关闭" aria-label="关闭">${Icons.render('close')}</button>
                </div>
            `;
        },

        // 渲染面板主体
        renderPanelBody(groups) {
            const content = groups.length > 0
                ? groups.map((group, gi) => this.renderGroup(group, gi)).join('')
                : '<div class="xjtu-empty">没有找到课件</div>';
            return `<div class="xjtu-sheet-body">${content}</div>`;
        },

        // 渲染组 (卡片)
        renderGroup(group, index) {
            const attachmentsHTML = group.attachments.map((att, ai) => this.renderAttachment(att, index, ai)).join('');
            const downloadableCount = group.attachments.filter(a => a.hasDownload).length;
            const meta = [
                group.module,
                `${group.attachments.length} 个文件`,
                `可下载 ${downloadableCount} 个`
            ].filter(Boolean).map(text => Utils.escapeHtml(text)).join(' · ');

            return `
                <div class="xjtu-card">
                    <div class="xjtu-card-header">
                        <div class="xjtu-avatar">${index + 1}</div>
                        <div class="xjtu-card-headline">
                            <div class="xjtu-card-title">${Utils.escapeHtml(group.name)}</div>
                            <div class="xjtu-card-subtitle">${meta}</div>
                        </div>
                        <button type="button" class="download-group-btn xjtu-btn xjtu-btn-tonal xjtu-btn-small" data-group="${index}"
                                ${downloadableCount > 0 ? '' : 'disabled'}>${Icons.render('download', 18)}下载本组</button>
                    </div>
                    ${attachmentsHTML}
                </div>
            `;
        },

        // 渲染附件 (列表项)
        renderAttachment(attachment, groupIndex, attachIndex) {
            const dataIndex = `${groupIndex}-${attachIndex}`;
            const displayName = attachment.fileName || attachment.name;
            const isProtected = attachment.hasDownload && !attachment.allowDownload;

            return `
                <div class="xjtu-list-item${attachment.hasDownload ? '' : ' xjtu-list-item-disabled'}">
                    ${this.renderFileBadge(displayName)}
                    <div class="xjtu-list-text">
                        <div class="xjtu-list-headline">${Utils.escapeHtml(displayName)}</div>
                        ${attachment.size || isProtected ? `
                            <div class="xjtu-list-supporting">
                                ${attachment.size ? `<span>${Utils.escapeHtml(attachment.size)}</span>` : ''}
                                ${isProtected ? `<span class="xjtu-label">${Icons.render('lock', 12)}私有版权保护</span>` : ''}
                            </div>
                        ` : ''}
                        ${attachment.error ? `<div class="xjtu-list-error">${Icons.render('error', 14)}${Utils.escapeHtml(attachment.error)}</div>` : ''}
                    </div>
                    <button type="button" class="download-single-btn xjtu-icon-btn xjtu-icon-btn-tonal" data-index="${dataIndex}"
                            title="下载" aria-label="下载 ${Utils.escapeHtml(displayName)}"
                            ${attachment.hasDownload ? '' : 'disabled'}>${Icons.render('download', 20)}</button>
                </div>
            `;
        },

        // 渲染文件类型标识
        renderFileBadge(fileName) {
            const match = fileName?.match(/\.([a-z0-9]{1,4})$/i);
            return `<div class="xjtu-file-badge">${match ? match[1].toUpperCase() : Icons.render('file')}</div>`;
        },

        // 渲染面板底部
        renderPanelFooter(stats) {
            return `
                <div class="xjtu-sheet-footer">
                    ${stats.noPermissionCount > 0 ? `
                        <div class="xjtu-note">${Icons.render('info', 16)}<span>${stats.noPermissionCount} 个课件通过技术手段获取，请合理使用</span></div>
                    ` : ''}
                    <div class="xjtu-actions">
                        <button type="button" id="copy-all-btn" class="xjtu-btn xjtu-btn-outlined">${Icons.render('copy', 18)}复制链接</button>
                        <button type="button" id="download-all-btn" class="xjtu-btn xjtu-btn-filled"
                                ${stats.downloadableCount > 0 ? '' : 'disabled'}>${Icons.render('download', 18)}下载全部 (${stats.downloadableCount})</button>
                    </div>
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
            UIManager.injectStyles();
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
            UIManager.updateMainButton(this.mainButton, '正在获取课件...', true);

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
                UIManager.updateMainButton(this.mainButton, CONSTANTS.MAIN_BUTTON_LABEL, false);
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
                    `正在获取课件... (${i + 1}/${containers.length})`,
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
