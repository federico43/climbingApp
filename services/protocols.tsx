export function getProtocol(){

    const description_silent_feet = 
    "move without making any sounds with the feet while you climb, climb with the tip of shoe, climb consciously, be delibarate. this enforces precision and slow climbing" 
    const description_two_hands = "Any move you wanna do has to be coordinated, using both hands for the move, reaching out with one hand is not allowed. record your attempts to analize later"
    const description_project_bouldering= "Choose a boulder that feels challenging but doable. Give yourself four attempts.\nif you fall, you can restart from where you fell without it counting as a new attempt. Falls right at the start also don’t count—an attempt only counts when you’ve genuinely tried, fallen, and then reset.\nAfter each attempt, take a moment to reflect on what happened. Was it a beta issue, lack of concentration, poor memory, or breathing?\nFocus on improving with each attempt. Try to better understand the crux move, paying close attention to how your body feels while moving—those sensations can give you useful cues about what you’re doing well.\nAsk your partner for feedback between attempts."
    const protocol =  [ 
    {type:"constraint_warmup", targetAttempts: 1, level: "orange", description: description_silent_feet},
    //{type:"constraint_warmup", targetAttempts: 1, level: "blue", description: description_two_hands},
    {type:"project_bouldering",targetAttempts: 4, restTime: 150, description: description_project_bouldering},
    {type: "strength_conditioning",
        description: "Pulling circuit — 3 rounds",
        rounds: 1,
        restBetweenRounds: 180, // 3 minutes
        exercises: [
            {
            type: "reps",
            name: "Rows",
            reps: "6-8",
            },
            {
            type: "7/3s",
            name: "7/3s",
            edge: "20mm",
            series: 6,
            },
            {
            type: "reps",
            name: "Pull ups",
            reps: "4-6",
            },
        ],
}]
    
    return protocol
}

