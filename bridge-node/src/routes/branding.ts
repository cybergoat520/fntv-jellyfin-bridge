/**
 * Branding 路由
 * /Branding/Configuration, /Branding/Css
 */

import { Hono } from 'hono';
import type { BrandingOptions } from '../types/jellyfin.ts';

const branding = new Hono();

/** GET /Branding/Configuration */
branding.get('/Configuration', (c) => {
  const options: BrandingOptions = {
    LoginDisclaimer: '',
    CustomCss: '',
    SplashscreenEnabled: false,
  };
  return c.json(options);
});

/** GET /Branding/Css, /Branding/Css.css */
branding.get('/Css', (c) => {
  c.header('Content-Type', 'text/css');
  return c.body('');
});
branding.get('/Css.css', (c) => {
  c.header('Content-Type', 'text/css');
  return c.body('');
});

export default branding;
