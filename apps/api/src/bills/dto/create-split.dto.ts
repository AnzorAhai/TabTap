import { IsInt, Max, Min } from "class-validator";

export const MAX_SPLIT_PARTICIPANTS = 30;

export class CreateSplitDto {
  @IsInt()
  @Min(1)
  @Max(MAX_SPLIT_PARTICIPANTS)
  participantsCount!: number;
}
