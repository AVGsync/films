package main

import (
	"log"

	"cinema/internal/app/apiserver"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()

	if err := apiserver.Run(); err != nil {
		log.Fatal(err)
	}
}
