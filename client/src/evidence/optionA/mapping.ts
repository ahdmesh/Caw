import type { MappingInput, NormalMappingResult } from './types';
import { runNormal, normalDependencies } from './normalInternal';

/** Verify NORMAL correspondence in provided evidence only.
 * Does not verify chain canonicality/finality, cryptographic signatures,
 * state transitions, or grant any mutation permission.
 * R37 resource-model limitations remain; see RESOURCE_MODEL.md.
 */
export function mapNormal(input: MappingInput): NormalMappingResult {
  return runNormal(input, normalDependencies);
}
