/**
 * HLD export (pilot WP-C, docs/v3/06): pure model builder, skeletons for the
 * manual sections, SVG diagram and the DOCX renderer.
 */
export * from './types'
export { buildHldModel, enabledSections, mergeManual, runLabel, sectionNumbers } from './build'
export { buildSkeleton, isAnnotation, type SkeletonInput } from './skeleton'
export { buildDiagramSvg, escapeXml, type DiagramSvg } from './diagram'
export { renderDocx, renderDocxBlob, renderDocxBytes, TEXT_WIDTH, type DiagramImage, type RenderOptions } from './render'
export { cleanText, fileSafe, formatNumber, hldFileName, localeOf, safeUrl, todayIso } from './format'
export { SECTION_TITLES, sectionTitle } from './i18n'
