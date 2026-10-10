import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { SLUG_PATTERN } from '../utils/slug.util';

@Injectable()
export class ParseSlugPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || value.length > 180 || !SLUG_PATTERN.test(value)) {
      throw new BadRequestException('Invalid slug');
    }
    return value;
  }
}
