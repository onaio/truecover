// Styles (import in your main CSS file or index)
import './styles/index.css';

/**
 * Tactical UI Library
 *
 * A tactical/terminal-themed UI component library with corner brackets,
 * monospace fonts, and military-inspired aesthetics.
 *
 * @example
 * import { TacticalCard, TacticalButton, theme } from './tactical-ui';
 *
 * function App() {
 *   return (
 *     <TacticalCard title="Mission Control">
 *       <TacticalButton variant="primary">Execute</TacticalButton>
 *     </TacticalCard>
 *   );
 * }
 */

// Components
export * from './components';

// Theme configuration
export { theme } from './config/theme';
export type { Theme } from './config/theme';
