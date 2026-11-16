import { SetMetadata } from '@nestjs/common';

/** Metadata key read by `LicenciaGlobalGuard`. */
export const SIN_LICENCIA_KEY = 'sin_licencia';

/**
 * Marks a controller or handler that must stay reachable WITHOUT a valid license: logging in,
 * reading the session and managing the license itself (otherwise an expired or revoked license
 * could never be renewed).
 */
export const SinLicencia = () => SetMetadata(SIN_LICENCIA_KEY, true);
