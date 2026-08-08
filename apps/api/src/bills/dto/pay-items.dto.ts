import { ArrayNotEmpty, IsArray, IsString } from "class-validator";

export class PayItemsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  itemIds!: string[];
}
