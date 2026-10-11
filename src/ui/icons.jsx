import React from 'react';
import {
  Mountain, Waves, Layers, Wind, Square, Compass, Triangle, Droplets, Sparkles, ScanLine,
  Snowflake, Sun, Cloud, CloudFog, Orbit, Camera, SlidersHorizontal, Aperture, Eye, EyeOff,
  Plus, Copy, Trash2, GripVertical, ChevronDown, ChevronRight, Box, Palette, Search,
  RotateCcw, Play, Pause, Download, Upload, Grid3x3, Trees, RefreshCw, Shuffle, MoveUpRight,
  Circle, Zap, Image, FileDown, Settings2, Thermometer, Ruler, Clock, Cpu, HardDrive,
  ArrowUpDown, Blend, Brush, Waves as Wave2, Flame, Feather,
} from 'lucide-react';

const REGISTRY = {
  Mountain, Waves, Wave2, Layers, Wind, Square, Compass, Triangle, Droplets, Sparkles,
  ScanLine, Snowflake, Sun, Cloud, CloudFog, Orbit, Camera, SlidersHorizontal, Aperture,
  Eye, EyeOff, Plus, Copy, Trash2, GripVertical, ChevronDown, ChevronRight, Box, Palette,
  Search, RotateCcw, Play, Pause, Download, Upload, Grid3x3, Trees, RefreshCw, Shuffle,
  MoveUpRight, Circle, Zap, Image, FileDown, Settings2, Thermometer, Ruler, Clock, Cpu,
  HardDrive, ArrowUpDown, Blend, Brush, Flame, Feather,
};

export function Icon({ name, size = 16, ...rest }) {
  const C = REGISTRY[name] ?? Square;
  return <C size={size} {...rest} />;
}

export { REGISTRY as ICONS };
