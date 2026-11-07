import { IsInt, IsOptional, IsPositive, IsString, IsUUID, Length, Min } from "class-validator";

export class CreatePaymentDto {
  @IsUUID()
  billId!: string;

  @IsOptional()
  @IsUUID()
  splitId?: string;

  @IsOptional()
  @IsUUID()
  participantId?: string;

  @IsInt()
  @IsPositive()
  amountMinor!: number;

  @IsString()
  @Length(3, 3)
  currency!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  tipMinor?: number;
}
