import type { ImageHealthParser } from './ImageHealthParser';
import { demoImageHealthParser } from './DemoImageHealthParser';
import { HttpImageHealthParser } from './HttpImageHealthParser';
import { runtimeConfig } from '../config/runtime';

export const imageHealthParser: ImageHealthParser = runtimeConfig.healthVisionMode === 'real'
  ? new HttpImageHealthParser(runtimeConfig.healthVisionEndpoint!)
  : demoImageHealthParser;
