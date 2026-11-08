import { PaymentMethod, PaymentMode, type CreatePaymentRequest, type SubmitProofRequest } from "@tabtap/shared";
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";

export class CreatePaymentDto implements CreatePaymentRequest {
  @IsIn(Object.values(PaymentMode))
  mode!: PaymentMode;

  @ValidateIf((dto: CreatePaymentDto) => dto.mode === PaymentMode.ITEMS)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  itemIds?: string[];

  @ValidateIf((dto: CreatePaymentDto) => dto.mode === PaymentMode.SHARES)
  @IsInt()
  @Min(1)
  @Max(30)
  shareCount?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  tipPercent?: number;

  @IsIn(Object.values(PaymentMethod))
  method!: PaymentMethod;
}

export class SubmitProofDto implements SubmitProofRequest {
  /** Bank reference, Zelle confirmation or Binance order id. */
  @Matches(/^[A-Za-z0-9-]{4,40}$/, { message: "reference must be 4-40 letters, digits or dashes" })
  reference!: string;

  @IsOptional()
  @Matches(/^[0-9+\-\s()]{7,20}$/, { message: "payerPhone must be a phone number" })
  payerPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  payerBank?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  payerName?: string;
}

export class MockConfirmDto {
  @IsIn(["succeeded", "failed"])
  outcome!: "succeeded" | "failed";
}
