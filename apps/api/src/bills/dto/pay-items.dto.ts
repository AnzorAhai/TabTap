import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsString, MaxLength } from "class-validator";

export class PayItemsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  itemIds!: string[];
}
