import { IsInt, Min } from "class-validator";

export class CreateSplitDto {
  @IsInt()
  @Min(1)
  participantsCount!: number;
}
