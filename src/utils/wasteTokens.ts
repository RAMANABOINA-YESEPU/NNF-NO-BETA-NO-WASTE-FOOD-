import React from 'react';
import {
  CheckCircle2,
  Info,
  Flame,
  AlertOctagon,
  Sparkles,
} from 'lucide-react';
import { WasteLevel } from '../types';

export interface WasteMeta {
  level: WasteLevel;
  label: string;
  sublabel: string;
  badgeClassDark: string;
  badgeClassLight: string;
  btnActiveDark: string;
  btnActiveLight: string;
  btnInactiveDark: string;
  btnInactiveLight: string;
  borderColor: string;
  dotColor: string;
  textColorDark: string;
  textColorLight: string;
  icon: typeof CheckCircle2;
}

export const WASTE_LEVEL_META: Record<WasteLevel, WasteMeta> = {
  None: {
    level: 'None',
    label: 'None',
    sublabel: 'Clean plate',
    badgeClassDark: 'bg-emerald-950/70 text-emerald-300 border-emerald-500/40',
    badgeClassLight: 'bg-emerald-50 text-emerald-800 border-emerald-300',
    btnActiveDark: 'bg-emerald-600 text-white border-emerald-400 ring-2 ring-emerald-400 shadow-lg shadow-emerald-950/50',
    btnActiveLight: 'bg-emerald-600 text-white border-emerald-500 ring-2 ring-emerald-500 shadow-md shadow-emerald-200',
    btnInactiveDark: 'bg-slate-900/60 text-emerald-400/90 border-slate-800 hover:bg-slate-800/80 hover:border-emerald-700/50',
    btnInactiveLight: 'bg-white text-emerald-700 border-slate-200 hover:bg-emerald-50/50 hover:border-emerald-300',
    borderColor: 'border-emerald-500',
    dotColor: 'bg-emerald-500',
    textColorDark: 'text-emerald-400',
    textColorLight: 'text-emerald-700',
    icon: CheckCircle2,
  },
  Low: {
    level: 'Low',
    label: 'Low',
    sublabel: '< 10% left',
    badgeClassDark: 'bg-amber-950/70 text-amber-300 border-amber-500/40',
    badgeClassLight: 'bg-amber-50 text-amber-800 border-amber-300',
    btnActiveDark: 'bg-amber-500 text-slate-950 border-amber-300 ring-2 ring-amber-300 shadow-lg shadow-amber-950/50 font-black',
    btnActiveLight: 'bg-amber-500 text-slate-950 border-amber-400 ring-2 ring-amber-400 shadow-md shadow-amber-200 font-bold',
    btnInactiveDark: 'bg-slate-900/60 text-amber-400/90 border-slate-800 hover:bg-slate-800/80 hover:border-amber-700/50',
    btnInactiveLight: 'bg-white text-amber-700 border-slate-200 hover:bg-amber-50/50 hover:border-amber-300',
    borderColor: 'border-amber-500',
    dotColor: 'bg-amber-500',
    textColorDark: 'text-amber-400',
    textColorLight: 'text-amber-700',
    icon: Info,
  },
  Medium: {
    level: 'Medium',
    label: 'Medium',
    sublabel: '10–40% left',
    badgeClassDark: 'bg-orange-950/70 text-orange-300 border-orange-500/40',
    badgeClassLight: 'bg-orange-50 text-orange-800 border-orange-300',
    btnActiveDark: 'bg-orange-500 text-white border-orange-300 ring-2 ring-orange-300 shadow-lg shadow-orange-950/50',
    btnActiveLight: 'bg-orange-500 text-white border-orange-400 ring-2 ring-orange-400 shadow-md shadow-orange-200',
    btnInactiveDark: 'bg-slate-900/60 text-orange-400/90 border-slate-800 hover:bg-slate-800/80 hover:border-orange-700/50',
    btnInactiveLight: 'bg-white text-orange-700 border-slate-200 hover:bg-orange-50/50 hover:border-orange-300',
    borderColor: 'border-orange-500',
    dotColor: 'bg-orange-500',
    textColorDark: 'text-orange-400',
    textColorLight: 'text-orange-700',
    icon: Flame,
  },
  High: {
    level: 'High',
    label: 'High',
    sublabel: '> 40% left',
    badgeClassDark: 'bg-rose-950/70 text-rose-300 border-rose-500/40',
    badgeClassLight: 'bg-rose-50 text-rose-800 border-rose-300',
    btnActiveDark: 'bg-rose-600 text-white border-rose-300 ring-2 ring-rose-400 shadow-lg shadow-rose-950/50',
    btnActiveLight: 'bg-rose-600 text-white border-rose-400 ring-2 ring-rose-400 shadow-md shadow-rose-200',
    btnInactiveDark: 'bg-slate-900/60 text-rose-400/90 border-slate-800 hover:bg-slate-800/80 hover:border-rose-700/50',
    btnInactiveLight: 'bg-white text-rose-700 border-slate-200 hover:bg-rose-50/50 hover:border-rose-300',
    borderColor: 'border-rose-500',
    dotColor: 'bg-rose-500',
    textColorDark: 'text-rose-400',
    textColorLight: 'text-rose-700',
    icon: AlertOctagon,
  },
};
