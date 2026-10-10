import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { AdminRole } from '../../../generated/prisma/enums';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../password.util';

const trimLower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class LoginDto {
  @ApiProperty({ example: 'admin@example.com' })
  @Transform(trimLower)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'correct-horse-Battery-staple-1' })
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword: string;

  @ApiProperty({
    minLength: PASSWORD_MIN_LENGTH,
    description: 'At least 12 characters with 3 of: lowercase, uppercase, digit, symbol',
  })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword: string;
}

export class AdminProfileDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Jane Doe' })
  name: string;

  @ApiProperty({ example: 'jane@example.com' })
  email: string;

  @ApiProperty({ enum: AdminRole, example: AdminRole.SUPER_ADMIN })
  role: AdminRole;
}

export class AuthTokensResponseDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType: 'Bearer';

  @ApiProperty({ example: 900, description: 'Access token lifetime in seconds' })
  expiresIn: number;

  @ApiProperty({ description: 'Echo this value in the X-CSRF-Token header for /refresh and /logout' })
  csrfToken: string;

  @ApiProperty({ type: AdminProfileDto })
  admin: AdminProfileDto;
}
