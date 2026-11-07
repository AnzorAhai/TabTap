import { PaymentMode, type CreatePaymentRequest } from "@tabtap/shared";
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

  @Matches(/^[A-Za-z]{3}$/, { message: "currency must be a 3-letter ISO 4217 code" })
  currency!: string;
}

export class MockConfirmDto {
  @IsIn(["succeeded", "failed"])
  outcome!: "succeeded" | "failed";
}
