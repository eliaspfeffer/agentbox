// A real SVG on disk appeared as missing: the picture scheme omitted its extension.
import {it,expect} from 'vitest';
import {servable,svgHeaders} from '../main/img-scheme.mjs';
it('allows SVG pictures inside the owned roots, including uppercase extensions',()=>{
 for(const file of ['/store/chart.svg','/store/chart.SVG']) expect(servable(file,['/store'])).toBe(true);
 for(const file of ['/else/chart.svg','/store-other/chart.svg','/store/config.json']) expect(servable(file,['/store'])).toBe(false);
});
it('makes SVG inert even when opened as a document, without changing raster responses',()=>{
 expect(svgHeaders('/store/chart.svg')).toEqual({'content-type':'image/svg+xml','content-security-policy':"sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",'x-content-type-options':'nosniff'});
 expect(svgHeaders('/store/chart.SVG')).toEqual(svgHeaders('/store/chart.svg'));
 expect(svgHeaders('/store/chart.png')).toEqual({});
});
