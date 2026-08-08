import { IsInt, IsOptional, IsPositive, IsString, Min } from "class-validator";

export class CreatePaymentDto {
  @IsString()
  billId!: string;

  @IsOptional()
  @IsString()
  splitId?: string;

  @IsOptional()
  @IsString()
  participantId?: string;

  @IsInt()
  @IsPositive()
  amountMinor!: number;

  @IsString()
  currency!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  tipMinor?: number;
}
