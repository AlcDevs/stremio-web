import React, { forwardRef } from 'react';
import { Section, Option } from '../components';
import styles from './Shortcuts.less';
import { useTranslation } from 'react-i18next';

const Shortcuts = forwardRef<HTMLDivElement>((_, ref) => {
    const { t } = useTranslation();

    return (
        <Section ref={ref} label={'SETTINGS_NAV_SHORTCUTS'}>
            <Option label={'SETTINGS_SHORTCUT_PLAY_PAUSE'}>
                <div className={styles['shortcut-container']}>
                    <kbd>{t('SETTINGS_SHORTCUT_SPACE')}</kbd>
                </div>
            </Option>
            <Option label={'SETTINGS_SHORTCUT_SEEK_FORWARD'}>
                <div className={styles['shortcut-container']}>
                    <kbd>→</kbd>
                    <div className={styles['label']}>{t('SETTINGS_SHORTCUT_OR')}</div>
                    <kbd>⇧ {t('SETTINGS_SHORTCUT_SHIFT')}</kbd>
                    <div className={styles['label']}>+</div>
                    <kbd>→</kbd>
                </div>
            </Option>
            <Option label={'SETTINGS_SHORTCUT_SEEK_BACKWARD'}>
                <div className={styles['shortcut-container']}>
                    <kbd>←</kbd>
                    <div className={styles['label']}>{t('SETTINGS_SHORTCUT_OR')}</div>
                    <kbd>⇧ {t('SETTINGS_SHORTCUT_SHIFT')}</kbd>
                    <div className={styles['label']}>+</div>
                    <kbd>←</kbd>
                </div>
            </Option>
            <Option label={'SETTINGS_SHORTCUT_VOLUME_UP'}>
                <div className={styles['shortcut-container']}>
                    <kbd>↑</kbd>
                </div>
            </Option>
            <Option label={'SETTINGS_SHORTCUT_VOLUME_DOWN'}>
                <div className={styles['shortcut-container']}>
                    <kbd>↓</kbd>
                </div>
            </Option>
            <Option label={'SETTINGS_SHORTCUT_MENU_SUBTITLES'}>
                <div className={styles['shortcut-container']}>
                    <kbd>S</kbd>
                </div>
            </Option>
            <Option label={'SETTINGS_SHORTCUT_MENU_AUDIO'}>
                <div className={styles['shortcut-container']}>
                    <kbd>A</kbd>
                </div>
            </Option>
            <Option label={'SETTINGS_SHORTCUT_MENU_INFO'}>
                <div className={styles['shortcut-container']}>
                    <kbd>I</kbd>
                </div>
            </Option>
            <Option label={'SETTINGS_SHORTCUT_FULLSCREEN'}>
                <div className={styles['shortcut-container']}>
                    <kbd>F</kbd>
                </div>
            </Option>
            <Option label={'SETTINGS_SHORTCUT_SUBTITLES_SIZE'}>
                <div className={styles['shortcut-container']}>
                    <kbd>-</kbd>
                    <div className={styles['label']}>{ t('SETTINGS_SHORTCUT_AND') }</div>
                    <kbd>=</kbd>
                </div>
            </Option>
            <Option label={'SETTINGS_SHORTCUT_SUBTITLES_DELAY'}>
                <div className={styles['shortcut-container']}>
                    <kbd>G</kbd>
                    <div className={styles['label']}>{ t('SETTINGS_SHORTCUT_AND') }</div>
                    <kbd>H</kbd>
                </div>
            </Option>
            <Option label={'SETTINGS_SHORTCUT_NAVIGATE_MENUS'}>
                <div className={styles['shortcut-container']}>
                    <kbd>1</kbd>
                    <div className={styles['label']}>{t('SETTINGS_SHORTCUT_TO')}</div>
                    <kbd>6</kbd>
                </div>
            </Option>
            <Option label={'SETTINGS_SHORTCUT_GO_TO_SEARCH'}>
                <div className={styles['shortcut-container']}>
                    <kbd>0</kbd>
                </div>
            </Option>
            <Option label={'SETTINGS_SHORTCUT_EXIT_BACK'}>
                <div className={styles['shortcut-container']}>
                    <kbd>{t('SETTINGS_SHORTCUT_ESC')}</kbd>
                </div>
            </Option>
        </Section>
    );
});

export default Shortcuts;
