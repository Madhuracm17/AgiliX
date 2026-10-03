import { IsDateString, IsOptional } from 'class-validator';

/**
 * Pauses a timer. When the web page pauses it because the person went idle, it
 * sends the moment of their last activity here, so the idle minute is not counted.
 * Optional: a normal Pause sends nothing and the time is "now".
 */
export class StopTimerDto {
  @IsOptional()
  @IsDateString()
  endedAt?: string;
}
