import { BadRequestException, Type } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';

/**
 * Validates tool input against an existing AgiliX DTO class, with the same
 * behaviour as the HTTP ValidationPipe in main.ts (whitelist + transform):
 * unknown properties are stripped and the DTO instance is returned.
 *
 * Throws BadRequestException (reported to the MCP client as "Error 400: ...").
 *
 * Example (inside a tool handler):
 *   const dto = await validateDto(CreateTaskDto, args);
 */
export async function validateDto<T extends object>(
  dtoClass: Type<T>,
  input: unknown,
): Promise<T> {
  const instance = plainToInstance(dtoClass, input ?? {});
  const errors = await validate(instance, { whitelist: true });

  if (errors.length > 0) {
    throw new BadRequestException(flattenValidationErrors(errors));
  }

  return instance;
}

function flattenValidationErrors(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => [
    ...Object.values(error.constraints ?? {}),
    ...flattenValidationErrors(error.children ?? []),
  ]);
}